
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
import os
import re

import jwt
from jwt.exceptions import InvalidTokenError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, ForeignKey, String, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{BASE_DIR / 'taskflow_auth.db'}",
)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not JWT_SECRET_KEY or len(JWT_SECRET_KEY) < 32:
    raise RuntimeError(
        "Set JWT_SECRET_KEY to a random secret of at least 32 characters"
    )

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)

password_hasher = PasswordHasher()
auth_scheme = HTTPBearer(auto_error=False)


class Base(DeclarativeBase):
    pass


class UserDB(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)

    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        index=True,
    )

    hashed_password: Mapped[str] = mapped_column(String(255))

    tasks: Mapped[list["TaskDB"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )


class TaskDB(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)

    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    title: Mapped[str] = mapped_column(String(120))

    priority: Mapped[str] = mapped_column(
        String(12),
        default="normal",
    )

    done: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )

    owner: Mapped[UserDB] = relationship(
        back_populates="tasks",
    )


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    priority: Literal["low", "normal", "high"] = "normal"


class TaskPatch(BaseModel):
    done: bool


class TaskOut(BaseModel):
    id: int
    title: str
    priority: str
    done: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="TaskFlow API",
    version="2.0.0",
    lifespan=lifespan,
)


def get_db():
    with SessionLocal() as db:
        yield db


Db = Annotated[Session, Depends(get_db)]


def token_for(user_id: int) -> str:
    now = datetime.now(timezone.utc)

    return jwt.encode(
        {
            "sub": str(user_id),
            "iat": now,
            "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        },
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(auth_scheme),
    ],
    db: Db,
) -> UserDB:
    unauthorized = HTTPException(
        status_code=401,
        detail="Войдите в аккаунт",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized

    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
        )

        user_id = int(payload["sub"])

    except (InvalidTokenError, KeyError, ValueError, TypeError):
        raise unauthorized

    user = db.get(UserDB, user_id)

    if user is None:
        raise unauthorized

    return user


User = Annotated[UserDB, Depends(current_user)]


def task_out(task: TaskDB) -> TaskOut:
    return TaskOut(
        id=task.id,
        title=task.title,
        priority=task.priority,
        done=task.done,
    )


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/style.css", include_in_schema=False)
def css():
    return FileResponse(
        BASE_DIR / "style.css",
        media_type="text/css",
    )


@app.get("/app.js", include_in_schema=False)
def javascript():
    return FileResponse(
        BASE_DIR / "app.js",
        media_type="application/javascript",
    )


@app.post(
    "/api/auth/register",
    response_model=UserOut,
    status_code=201,
)
def register(data: Credentials, db: Db):
    username = data.username.strip()

    if not re.fullmatch(r"[A-Za-z0-9_]{3,50}", username):
        raise HTTPException(
            422,
            "Имя: 3–50 латинских букв, цифр или _",
        )

    user = UserDB(
        username=username,
        hashed_password=password_hasher.hash(data.password),
    )

    db.add(user)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409,
            "Имя пользователя занято",
        )

    db.refresh(user)

    return UserOut(
        id=user.id,
        username=user.username,
    )


@app.post("/api/auth/login")
def login(data: Credentials, db: Db):
    user = db.scalar(
        select(UserDB).where(
            UserDB.username == data.username.strip()
        )
    )

    if user is None:
        raise HTTPException(
            401,
            "Неверное имя или пароль",
        )

    try:
        password_hasher.verify(
            user.hashed_password,
            data.password,
        )

    except (VerifyMismatchError, VerificationError):
        raise HTTPException(
            401,
            "Неверное имя или пароль",
        )

    return {
        "access_token": token_for(user.id),
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_MINUTES * 60,
    }


@app.get("/api/auth/me", response_model=UserOut)
def me(user: User):
    return UserOut(
        id=user.id,
        username=user.username,
    )


@app.get("/api/tasks", response_model=list[TaskOut])
def list_tasks(user: User, db: Db):
    tasks = db.scalars(
        select(TaskDB)
        .where(TaskDB.owner_id == user.id)
        .order_by(TaskDB.id.desc())
    ).all()

    return [task_out(task) for task in tasks]


@app.post(
    "/api/tasks",
    response_model=TaskOut,
    status_code=201,
)
def create_task(data: TaskIn, user: User, db: Db):
    title = data.title.strip()

    if not title:
        raise HTTPException(
            422,
            "Название задачи не может быть пустым",
        )

    task = TaskDB(
        owner_id=user.id,
        title=title,
        priority=data.priority,
        done=False,
    )

    db.add(task)
    db.commit()
    db.refresh(task)

    return task_out(task)


@app.patch(
    "/api/tasks/{task_id}",
    response_model=TaskOut,
)
def update_task(
    task_id: int,
    data: TaskPatch,
    user: User,
    db: Db,
):
    task = db.scalar(
        select(TaskDB).where(
            TaskDB.id == task_id,
            TaskDB.owner_id == user.id,
        )
    )

    if task is None:
        raise HTTPException(
            404,
            "Задача не найдена",
        )

    task.done = data.done
    db.commit()

    return task_out(task)


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, user: User, db: Db):
    task = db.scalar(
        select(TaskDB).where(
            TaskDB.id == task_id,
            TaskDB.owner_id == user.id,
        )
    )

    if task is None:
        raise HTTPException(
            404,
            "Задача не найдена",
        )

    db.delete(task)
    db.commit()

    return Response(status_code=204)
