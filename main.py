from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "taskflow.db"
SEED_TASKS = [
    ("Повторить основы FastAPI", "high", 0),
    ("Закончить проект для портфолио", "normal", 0),
    ("Подготовиться к НМТ", "high", 1),
    ("Прочитать 10 страниц книги", "low", 0),
]

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    priority: Literal["low", "normal", "high"] = "normal"
    done: bool = False

class TaskUpdate(BaseModel):
    done: bool


def get_connection():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def serialize_task(task):
    return {
        "id": task["id"],
        "title": task["title"],
        "priority": task["priority"],
        "done": bool(task["done"]),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_is_new = not DB_PATH.exists()
    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                priority TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0
            )
        """)
        if database_is_new:
            connection.executemany(
                "INSERT INTO tasks (title, priority, done) VALUES (?, ?, ?)",
                SEED_TASKS,
            )
    yield


app = FastAPI(
    title="TaskFlow API",
    description="REST API для управления задачами",
    version="1.1.0",
    lifespan=lifespan,
)


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/static/style.css", include_in_schema=False)
def serve_css():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css")


@app.get("/static/app.js", include_in_schema=False)
def serve_javascript():
    return FileResponse(BASE_DIR / "app.js", media_type="application/javascript")


@app.get("/api/tasks")
def get_tasks():
    with get_connection() as connection:
        tasks = connection.execute(
            "SELECT id, title, priority, done FROM tasks ORDER BY id DESC"
        ).fetchall()
    return [serialize_task(task) for task in tasks]


@app.post("/api/tasks", status_code=201)
def create_task(data: TaskCreate):
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Название задачи не может быть пустым")
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO tasks (title, priority, done) VALUES (?, ?, ?)",
            (title, data.priority, int(data.done)),
        )
        task = connection.execute(
            "SELECT id, title, priority, done FROM tasks WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return serialize_task(task)


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, data: TaskUpdate):
    with get_connection() as connection:
        cursor = connection.execute(
            "UPDATE tasks SET done = ? WHERE id = ?",
            (int(data.done), task_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Задача не найдена")
        task = connection.execute(
            "SELECT id, title, priority, done FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
    return serialize_task(task)


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int):
    with get_connection() as connection:
        cursor = connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Задача не найдена")
    return Response(status_code=204)
