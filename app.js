const API_URL = "/api/tasks";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const tasksContainer = $("#tasks");
const taskForm = $("#taskForm");
const taskTitle = $("#taskTitle");
const taskPriority = $("#taskPriority");
const searchInput = $("#search");
const toastElement = $("#toast");
const priorityNames = { low: "Низкий", normal: "Обычный", high: "Высокий" };
const defaultPreferences = { theme: "light", accent: "blue", density: "comfortable", focus: false };
const validOptions = {
    theme: ["light", "dark"],
    accent: ["blue", "violet", "green", "orange"],
    density: ["comfortable", "compact"]
};
let tasks = [];
let currentFilter = "all";
let preferences = loadPreferences();
let toastTimer;

function loadPreferences() {
    try {
        const stored = JSON.parse(localStorage.getItem("taskflow-preferences") || "{}");
        return {
            theme: validOptions.theme.includes(stored.theme) ? stored.theme : "light",
            accent: validOptions.accent.includes(stored.accent) ? stored.accent : "blue",
            density: validOptions.density.includes(stored.density) ? stored.density : "comfortable",
            focus: stored.focus === true
        };
    } catch {
        return { ...defaultPreferences };
    }
}

function applyPreferences() {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.dataset.accent = preferences.accent;
    root.dataset.density = preferences.density;
    $("#focusToggle").checked = preferences.focus;
    $$('[data-theme-option]').forEach(button => {
        const selected = button.dataset.themeOption === preferences.theme;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
    $$('[data-accent-option]').forEach(button => {
        const selected = button.dataset.accentOption === preferences.accent;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
    $$('[data-density-option]').forEach(button => {
        const selected = button.dataset.densityOption === preferences.density;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
    const banner = $("#focusNotice");
    if (banner) banner.remove();
    if (preferences.focus) {
        const notice = document.createElement("div");
        notice.className = "focus-notice";
        notice.id = "focusNotice";
        const text = document.createElement("span");
        text.textContent = "◎ Режим фокуса включён — завершённые задачи скрыты";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Выключить";
        button.addEventListener("click", () => updatePreferences("focus", false));
        notice.append(text, button);
        $(".task-panel").prepend(notice);
    }
    renderTasks();
}

function updatePreferences(key, value) {
    preferences = { ...preferences, [key]: value };
    try {
        localStorage.setItem("taskflow-preferences", JSON.stringify(preferences));
    } catch {
        showToast("Браузер не разрешает сохранять настройки", true);
    }
    applyPreferences();
}

function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    toastElement.textContent = message;
    toastElement.classList.toggle("error", isError);
    toastElement.classList.add("show");
    toastTimer = setTimeout(() => toastElement.classList.remove("show"), 3000);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    if (!response.ok) {
        let message = `Ошибка сервера: ${response.status}`;
        try {
            const data = await response.json();
            if (typeof data.detail === "string") message = data.detail;
        } catch {}
        throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
}

async function loadTasks() {
    try {
        tasks = await apiRequest(API_URL);
        updateStats();
        renderTasks();
    } catch (error) {
        tasksContainer.replaceChildren();
        const message = document.createElement("div");
        message.className = "empty";
        message.textContent = "Не удалось загрузить задачи. Проверь подключение к серверу.";
        tasksContainer.append(message);
        showToast(error.message, true);
    }
}

function updateStats() {
    const total = tasks.length;
    const done = tasks.filter(task => task.done).length;
    $("#statAll").textContent = total;
    $("#statActive").textContent = total - done;
    $("#statDone").textContent = `${total ? Math.round(done / total * 100) : 0}%`;
    $("#allCount").textContent = total;
}

function getFilteredTasks() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    return tasks.filter(task => {
        const matchingText = task.title.toLocaleLowerCase().includes(query);
        const matchingFilter = currentFilter === "all" ||
            (currentFilter === "active" && !task.done) ||
            (currentFilter === "done" && task.done);
        return matchingText && matchingFilter && (!preferences.focus || !task.done);
    });
}

function createTaskElement(task) {
    const item = document.createElement("div");
    item.className = `task-item ${task.done ? "done" : ""}`;
    const checkButton = document.createElement("button");
    checkButton.type = "button";
    checkButton.className = "task-check";
    checkButton.textContent = task.done ? "✓" : "";
    checkButton.setAttribute("aria-label", task.done ? "Вернуть в активные" : "Отметить выполненной");
    checkButton.addEventListener("click", () => toggleTask(task.id, !task.done));
    const info = document.createElement("div");
    info.className = "task-info";
    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = task.done ? "Задача завершена" : "Личный план · сегодня";
    info.append(title, meta);
    const priority = document.createElement("span");
    const key = Object.hasOwn(priorityNames, task.priority) ? task.priority : "normal";
    priority.className = `priority ${key}`;
    priority.textContent = priorityNames[key];
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-btn";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", "Удалить задачу");
    deleteButton.addEventListener("click", () => deleteTask(task.id));
    item.append(checkButton, info, priority, deleteButton);
    return item;
}

function renderTasks() {
    const shown = getFilteredTasks();
    tasksContainer.replaceChildren();
    if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = preferences.focus && tasks.some(task => task.done) && !tasks.some(task => !task.done)
            ? "Все задачи выполнены! Выключи режим фокуса, чтобы увидеть их."
            : tasks.length ? "Задачи не найдены." : "Пока нет задач. Добавь свою первую задачу!";
        tasksContainer.append(empty);
        return;
    }
    tasksContainer.append(...shown.map(createTaskElement));
}

function setFilter(filter) {
    currentFilter = filter;
    $$('[data-filter]').forEach(button => {
        if (button.classList.contains("side-link")) button.classList.toggle("active", button.dataset.filter === filter);
        if (button.classList.contains("tab")) button.classList.toggle("selected", button.dataset.filter === filter);
    });
    renderTasks();
}

function showView(view) {
    const settings = view === "settings";
    $("#dashboardView").classList.toggle("hidden", settings);
    $("#settingsView").classList.toggle("hidden", !settings);
    $("#currentPage").textContent = settings ? " Настройки" : " Обзор";
    $$('[data-view]').forEach(button => {
        button.classList.toggle("active", button.dataset.view === view && (settings || button.dataset.filter === currentFilter));
    });
    window.scrollTo({ top: 0, behavior: "instant" });
}

async function createTask(event) {
    event.preventDefault();
    const title = taskTitle.value.trim();
    if (!title) return showToast("Введите название задачи", true);
    const submit = taskForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        const added = await apiRequest(API_URL, {
            method: "POST",
            body: JSON.stringify({ title, priority: taskPriority.value, done: false })
        });
        tasks.unshift(added);
        searchInput.value = "";
        setFilter("all");
        updateStats();
        closeForm();
        showToast("Задача успешно добавлена");
    } catch (error) {
        showToast(error.message, true);
    } finally {
        submit.disabled = false;
    }
}

function closeForm() {
    taskForm.classList.add("hidden");
    $("#openForm").classList.remove("hidden");
    taskForm.reset();
}

async function toggleTask(id, done) {
    try {
        const updated = await apiRequest(`${API_URL}/${id}`, { method: "PATCH", body: JSON.stringify({ done }) });
        tasks = tasks.map(task => task.id === id ? updated : task);
        updateStats();
        renderTasks();
        showToast(done ? "Задача выполнена!" : "Задача снова активна");
    } catch (error) {
        showToast(error.message, true);
    }
}

async function deleteTask(id) {
    try {
        await apiRequest(`${API_URL}/${id}`, { method: "DELETE" });
        tasks = tasks.filter(task => task.id !== id);
        updateStats();
        renderTasks();
        showToast("Задача удалена");
    } catch (error) {
        showToast(error.message, true);
    }
}

$("#today").textContent = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
$("#openForm").addEventListener("click", () => {
    taskForm.classList.remove("hidden");
    $("#openForm").classList.add("hidden");
    taskTitle.focus();
});
$("#cancelForm").addEventListener("click", closeForm);
taskForm.addEventListener("submit", createTask);
searchInput.addEventListener("input", renderTasks);
$$('[data-filter]').forEach(button => button.addEventListener("click", () => {
    setFilter(button.dataset.filter);
    showView("dashboard");
}));
$("#settingsNav").addEventListener("click", () => showView("settings"));
$("#returnDashboard").addEventListener("click", () => showView("dashboard"));
$$('[data-theme-option]').forEach(button => button.addEventListener("click", () => updatePreferences("theme", button.dataset.themeOption)));
$$('[data-accent-option]').forEach(button => button.addEventListener("click", () => updatePreferences("accent", button.dataset.accentOption)));
$$('[data-density-option]').forEach(button => button.addEventListener("click", () => updatePreferences("density", button.dataset.densityOption)));
$("#focusToggle").addEventListener("change", event => updatePreferences("focus", event.target.checked));
$("#resetSettings").addEventListener("click", () => {
    preferences = { ...defaultPreferences };
    try { localStorage.removeItem("taskflow-preferences"); } catch {}
    applyPreferences();
    showToast("Настройки сброшены");
});
applyPreferences();
loadTasks();
