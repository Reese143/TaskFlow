
const $ = id => document.getElementById(id);

let token = sessionStorage.getItem("taskflow_token") || "";
let tasks = [];
let filter = "all";
let authMode = "login";
let toastTimer;

function toast(message) {
    const box = $("toast");

    box.textContent = message;
    box.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        box.classList.remove("show");
    }, 3000);
}

async function api(path, method = "GET", payload) {
    const headers = {};

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    if (payload !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    let response;

    try {
        response = await fetch(path, {
            method,
            headers,
            body: payload === undefined
                ? undefined
                : JSON.stringify(payload),
        });
    } catch {
        throw new Error("Сервер недоступен. Проверь FastAPI.");
    }

    if (!response.ok) {
        let message = `Ошибка ${response.status}`;

        try {
            const data = await response.json();

            if (typeof data.detail === "string") {
                message = data.detail;
            }
        } catch {}

        if (response.status === 401 && !path.endsWith("/login")) {
            logout(false);
        }

        throw new Error(message);
    }

    return response.status === 204 ? null : response.json();
}

function logout(notify = true) {
    token = "";
    tasks = [];

    sessionStorage.removeItem("taskflow_token");

    $("appView").hidden = true;
    $("authView").hidden = false;
    $("authPassword").value = "";

    if (notify) {
        toast("Вы вышли из аккаунта");
    }
}

function setAuthMode(mode) {
    authMode = mode;

    document.querySelectorAll("[data-mode]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.mode === mode
        );
    });

    $("authHeading").textContent = mode === "login"
        ? "С возвращением!"
        : "Создай свой аккаунт";

    $("authSubtitle").textContent = mode === "login"
        ? "Войди, чтобы продолжить свой день."
        : "Начни планировать дела в своём пространстве.";

    $("authSubmit").textContent = mode === "login"
        ? "Войти в TaskFlow →"
        : "Зарегистрироваться →";

    $("authPassword").autocomplete = mode === "login"
        ? "current-password"
        : "new-password";

    $("authError").textContent = "";
}

async function authenticate(event) {
    event.preventDefault();

    const button = $("authSubmit");
    button.disabled = true;

    $("authError").textContent = "";

    const data = {
        username: $("authUsername").value.trim(),
        password: $("authPassword").value,
    };

    try {
        if (authMode === "register") {
            await api("/api/auth/register", "POST", data);
        }

        const result = await api(
            "/api/auth/login",
            "POST",
            data
        );

        token = result.access_token;

        sessionStorage.setItem("taskflow_token", token);

        await showApp();
    } catch (error) {
        $("authError").textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

async function showApp() {
    try {
        const user = await api("/api/auth/me");

        $("usernameLabel").textContent = user.username;
        $("userAvatar").textContent = user.username[0].toUpperCase();

        await refreshTasks();

        $("authView").hidden = true;
        $("appView").hidden = false;
    } catch (error) {
        if (token) {
            toast(error.message);
        }
    }
}

async function refreshTasks() {
    tasks = await api("/api/tasks");

    updateStats();
    renderTasks();
}

function updateStats() {
    const total = tasks.length;
    const done = tasks.filter(item => item.done).length;

    $("statAll").textContent = total;
    $("statActive").textContent = total - done;

    $("statDone").textContent = total
        ? `${Math.round(done / total * 100)}%`
        : "0%";
}

function setFilter(next) {
    filter = next;

    document.querySelectorAll("[data-filter]").forEach(button => {
        const active = button.dataset.filter === next;
        button.classList.toggle("active", active);
    });

    $("dashboardView").hidden = false;
    $("settingsView").hidden = true;
    $("pageName").textContent = "Обзор";

    $("settingsButton").classList.remove("active");

    renderTasks();
}

function element(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
        node.className = className;
    }

    if (text !== undefined) {
        node.textContent = text;
    }

    return node;
}

function renderTasks() {
    const container = $("taskList");

    container.replaceChildren();

    const search = $("searchInput").value.toLowerCase().trim();

    const visible = tasks.filter(item => {
        const matchesFilter = filter === "all"
            || (filter === "done" ? item.done : !item.done);

        const matchesSearch = item.title
            .toLowerCase()
            .includes(search);

        return matchesFilter && matchesSearch;
    });

    if (!visible.length) {
        container.append(
            element(
                "div",
                "empty",
                tasks.length
                    ? "По этому запросу задач нет"
                    : "Здесь пока пусто. Создай первую задачу!"
            )
        );

        return;
    }

    const names = {
        low: "Низкий",
        normal: "Обычный",
        high: "Высокий",
    };

    visible.forEach(task => {
        const row = element(
            "div",
            `task-row${task.done ? " done" : ""}`
        );

        const check = element(
            "button",
            "task-check",
            task.done ? "✓" : ""
        );

        check.type = "button";

        check.setAttribute(
            "aria-label",
            task.done ? "Сделать активной" : "Завершить задачу"
        );

        check.addEventListener("click", async () => {
            check.disabled = true;

            try {
                const changed = await api(
                    `/api/tasks/${task.id}`,
                    "PATCH",
                    {done: !task.done}
                );

                tasks = tasks.map(t =>
                    t.id === task.id ? changed : t
                );

                updateStats();
                renderTasks();
            } catch (error) {
                toast(error.message);
                check.disabled = false;
            }
        });

        const info = element("div", "task-info");

        info.append(
            element("strong", "", task.title),
            element(
                "small",
                "",
                task.done ? "Задача завершена" : "Личный план"
            )
        );

        const safePriority = ["low", "normal", "high"].includes(
            task.priority
        ) ? task.priority : "normal";

        const priority = element(
            "span",
            `priority ${safePriority}`,
            names[safePriority]
        );

        const remove = element("button", "delete", "×");

        remove.type = "button";
        remove.setAttribute("aria-label", "Удалить задачу");

        remove.addEventListener("click", async () => {
            remove.disabled = true;

            try {
                await api(
                    `/api/tasks/${task.id}`,
                    "DELETE"
                );

                tasks = tasks.filter(t => t.id !== task.id);

                updateStats();
                renderTasks();

                toast("Задача удалена");
            } catch (error) {
                toast(error.message);
                remove.disabled = false;
            }
        });

        row.append(check, info, priority, remove);
        container.append(row);
    });
}

async function createTask(event) {
    event.preventDefault();

    const title = $("taskTitle").value.trim();

    if (!title) {
        return;
    }

    const button = $("taskForm").querySelector(
        '[type="submit"]'
    );

    button.disabled = true;

    try {
        const item = await api(
            "/api/tasks",
            "POST",
            {
                title,
                priority: $("taskPriority").value,
            }
        );

        tasks.unshift(item);

        $("taskForm").hidden = true;
        $("taskForm").reset();
        $("searchInput").value = "";

        setFilter("all");
        updateStats();

        toast("Задача добавлена");
    } catch (error) {
        toast(error.message);
    } finally {
        button.disabled = false;
    }
}

function readPrefs() {
    try {
        return JSON.parse(
            localStorage.getItem("taskflow_prefs")
        ) || {};
    } catch {
        return {};
    }
}

function applyPrefs() {
    const prefs = readPrefs();

    document.body.classList.toggle(
        "dark",
        !!prefs.dark
    );

    document.body.classList.toggle(
        "compact",
        !!prefs.compact
    );

    document.body.dataset.accent = [
        "blue", "purple", "green"
    ].includes(prefs.color) ? prefs.color : "blue";

    $("darkMode").checked = !!prefs.dark;
    $("compactMode").checked = !!prefs.compact;

    document.querySelectorAll("[data-color]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.color === document.body.dataset.accent
        );
    });
}

function savePrefs(changes) {
    localStorage.setItem(
        "taskflow_prefs",
        JSON.stringify({
            ...readPrefs(),
            ...changes,
        })
    );

    applyPrefs();
}

document.querySelectorAll("[data-mode]").forEach(button => {
    button.addEventListener("click", () => {
        setAuthMode(button.dataset.mode);
    });
});

$("authForm").addEventListener("submit", authenticate);

$("logoutButton").addEventListener("click", () => {
    logout();
});

$("mobileLogout").addEventListener("click", () => {
    logout();
});

$("today").textContent = new Date().toLocaleDateString(
    "ru-RU",
    {
        day: "numeric",
        month: "long",
        year: "numeric",
    }
);

document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        setFilter(button.dataset.filter);
    });
});

$("searchInput").addEventListener("input", renderTasks);

$("newTaskButton").addEventListener("click", () => {
    $("taskForm").hidden = false;
    $("taskTitle").focus();
});

$("cancelTask").addEventListener("click", () => {
    $("taskForm").hidden = true;
    $("taskForm").reset();
});

$("taskForm").addEventListener("submit", createTask);

$("settingsButton").addEventListener("click", () => {
    $("settingsView").hidden = false;
    $("dashboardView").hidden = true;
    $("pageName").textContent = "Настройки";

    document.querySelectorAll(".side-link").forEach(button => {
        button.classList.remove("active");
    });

    $("settingsButton").classList.add("active");
});

$("darkMode").addEventListener("change", event => {
    savePrefs({dark: event.target.checked});
});

$("compactMode").addEventListener("change", event => {
    savePrefs({compact: event.target.checked});
});

document.querySelectorAll("[data-color]").forEach(button => {
    button.addEventListener("click", () => {
        savePrefs({color: button.dataset.color});
    });
});

applyPrefs();

if (token) {
    showApp();
}
