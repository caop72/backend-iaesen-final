# main.py - Backend completo para la entrevista
import os
import sqlite3
import uuid
import json
import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import aiofiles
from typing import Optional

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuración
DB_PATH = "entrevistas.db"
AUDIO_BASE = "/data/audios"  # Cambiar según entorno

# ------------------------------------------------------------------
# BASE DE DATOS (SQLite)
# ------------------------------------------------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS sesiones (
        id TEXT PRIMARY KEY,
        role TEXT,
        perfil TEXT,
        nombre TEXT,
        email TEXT,
        institucion TEXT,
        grado TEXT,
        cargo TEXT,
        lang TEXT,
        created_at TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS respuestas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sesion_id TEXT,
        item_idx INTEGER,
        sub_idx INTEGER,
        audio_path TEXT,
        video_path TEXT,
        transcripcion TEXT,
        lang TEXT,
        synced BOOLEAN DEFAULT 0,
        created_at TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS perfiles (
        id TEXT PRIMARY KEY,
        nombre TEXT,
        items TEXT
    )''')
    conn.commit()
    conn.close()

# Cargar matriz de expertos
def cargar_matriz():
    with open("matriz.json", "r") as f:
        return json.load(f)

init_db()
matriz = cargar_matriz()

# ------------------------------------------------------------------
# ENDPOINTS DE LA API
# ------------------------------------------------------------------
@app.post("/api/sesion")
async def crear_sesion(role: str = Form(...), perfil: Optional[str] = Form(None), 
                       nombre: Optional[str] = Form(None), email: Optional[str] = Form(None),
                       cargo: Optional[str] = Form(None), institucion: Optional[str] = Form(None),
                       grado: Optional[str] = Form(None), lang: str = Form("es-VE")):
    session_id = str(uuid.uuid4())
    items = []
    
    if role == "experto" and perfil:
        # Buscar perfil en la matriz
        for key, val in matriz.items():
            if val["id"] == perfil:
                items = val["items"]
                break
    elif role == "no_experto":
        # No experto: selección aleatoria de 3 ítems del pool
        import random
        pool = [1,2,3,4,6,12]
        items = random.sample(pool, 3)
        nombre = "Anónimo"
        email = f"anonimo_{uuid.uuid4()}@noemail.com"
        cargo = "Particular"
        institucion = "Ciudadano"
        grado = "Ciudadano"

    # Guardar sesión en BD
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''INSERT INTO sesiones (id, role, perfil, nombre, email, institucion, grado, cargo, lang, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
              (session_id, role, perfil, nombre, email, institucion, grado, cargo, lang, datetime.datetime.now()))
    conn.commit()
    conn.close()

    return JSONResponse({
        "sessionId": session_id,
        "items": items,
        "lang": lang
    })

@app.get("/api/perfiles")
async def listar_perfiles():
    perfiles = []
    for key, val in matriz.items():
        perfiles.append({"id": key, "nombre": val["nombre"]})
    return JSONResponse(perfiles)

@app.get("/api/audio/{tipo}/{numero}")
async def get_audio(tipo: str, numero: int):
    # Si tipo es 'pregunta', el archivo se llama p#.mp3
    # Si tipo es 'item', el archivo se llama i#.mp3
    if tipo == "pregunta":
        nombre_archivo = f"p{numero}.mp3"
    elif tipo == "item":
        nombre_archivo = f"i{numero}.mp3"
    else:
        raise HTTPException(400, "Tipo de audio no válido")
    
    archivo = os.path.join(AUDIO_BASE, nombre_archivo)
    if not os.path.exists(archivo):
        raise HTTPException(404, "Audio no encontrado")
    return FileResponse(archivo, media_type="audio/mpeg")

@app.get("/api/pregunta/{numero}")
async def get_pregunta(numero: int, lang: str = "es-VE"):
    # Aquí se cargarían las preguntas traducidas desde un JSON
    # Por ahora, retornamos un texto dummy
    textos = {
        "es-VE": f"Pregunta número {numero} en español de Venezuela.",
        "es-ES": f"Pregunta número {numero} en español de España.",
        "en-US": f"Question number {numero} in English.",
        "pt-BR": f"Pergunta número {numero} em português."
    }
    return JSONResponse({"texto": textos.get(lang, textos["es-VE"])})

@app.post("/api/respuesta")
async def guardar_respuesta(
    sessionId: str = Form(...),
    itemIdx: int = Form(...),
    subIdx: int = Form(...),
    transcripcion: str = Form(...),
    perfil: str = Form(...),
    lang: str = Form("es-VE"),
    audio: Optional[UploadFile] = File(None),
    video: Optional[UploadFile] = File(None)
):
    audio_path = None
    video_path = None
    
    if audio:
        audio_path = f"/data/audios_respuestas/{sessionId}_{itemIdx}_{subIdx}_audio.webm"
        async with aiofiles.open(audio_path, 'wb') as f:
            await f.write(await audio.read())
    
    if video:
        video_path = f"/data/videos_respuestas/{sessionId}_{itemIdx}_{subIdx}_video.webm"
        async with aiofiles.open(video_path, 'wb') as f:
            await f.write(await video.read())

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''INSERT INTO respuestas (sesion_id, item_idx, sub_idx, audio_path, video_path, transcripcion, lang, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
              (sessionId, itemIdx, subIdx, audio_path, video_path, transcripcion, lang, datetime.datetime.now()))
    conn.commit()
    conn.close()
    
    return JSONResponse({"status": "ok"})

@app.get("/api/admin/dashboard")
async def dashboard():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM respuestas")
    total_respuestas = c.fetchone()[0]
    c.execute("SELECT COUNT(DISTINCT sesion_id) FROM respuestas")
    total_sesiones = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM respuestas WHERE video_path IS NOT NULL AND transcripcion IS NULL")
    videos_pendientes = c.fetchone()[0]
    conn.close()
    return JSONResponse({
        "totalRespuestas": total_respuestas,
        "totalSesiones": total_sesiones,
        "videosPendientes": videos_pendientes
    })

@app.post("/api/admin/sincronizar_videos")
async def sincronizar_videos():
    # Simulación de sincronización
    # En producción, esto extraería el audio del video y lo transcribiría
    return JSONResponse({"mensaje": "Sincronización completada. 5 videos transcritos."})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)