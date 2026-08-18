import os
import sqlite3
import uuid
import json
import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import aiofiles
from typing import Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "entrevistas.db"
AUDIO_BASE = os.path.join(os.path.dirname(__file__), "audios")

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
        sync_status TEXT DEFAULT 'pending',
        sync_error TEXT,
        synced_at TIMESTAMP,
        created_at TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS perfiles (
        id TEXT PRIMARY KEY,
        nombre TEXT,
        items TEXT
    )''')
    conn.commit()
    conn.close()

def cargar_matriz():
    with open("matriz.json", "r") as f:
        return json.load(f)

init_db()
matriz = cargar_matriz()

def obtener_servicio_sheets():
    raw = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not raw:
        raise ValueError("GOOGLE_CREDENTIALS_JSON no configurada")
    creds_dict = json.loads(raw)
    credentials = service_account.Credentials.from_service_account_info(
        creds_dict,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)

def sincronizar_respuesta(respuesta_id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''SELECT sesion_id, item_idx, sub_idx, transcripcion, audio_path, video_path 
                 FROM respuestas WHERE id = ?''', (respuesta_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return
    sesion_id, item_idx, sub_idx, transcripcion, audio_path, video_path = row
    try:
        service = obtener_servicio_sheets()
        sheet_id = "1GJYdj0DK2U_FGMqHvt4QrOPOHrvWLb1TcjsbQ4NcIkY"
        sheet_metadata = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        sheet_name = sheet_metadata['sheets'][0]['properties']['title']
        valores = [[
            sesion_id, item_idx + 1, sub_idx + 1, transcripcion,
            audio_path or "", video_path or "",
            datetime.datetime.now().isoformat()
        ]]
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range=f"{sheet_name}!A:G",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": valores}
        ).execute()
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''UPDATE respuestas SET sync_status = 'synced', synced_at = ? WHERE id = ?''',
                  (datetime.datetime.now().isoformat(), respuesta_id))
        conn.commit()
        conn.close()
    except Exception as e:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''UPDATE respuestas SET sync_status = 'failed', sync_error = ? WHERE id = ?''',
                  (str(e), respuesta_id))
        conn.commit()
        conn.close()

@app.post("/api/sesion")
async def crear_sesion(role: str = Form(...), perfil: Optional[str] = Form(None), 
                       nombre: Optional[str] = Form(None), email: Optional[str] = Form(None),
                       cargo: Optional[str] = Form(None), institucion: Optional[str] = Form(None),
                       grado: Optional[str] = Form(None), lang: str = Form("es-VE")):
    session_id = str(uuid.uuid4())
    items = []
    if role == "experto" and perfil:
        for key, val in matriz.items():
            if val["id"] == perfil:
                items = val["items"]
                break
    elif role == "no_experto":
        import random
        pool = [1,2,3,4,6,12]
        items = random.sample(pool, 3)
        nombre = "Anónimo"
        email = f"anonimo_{uuid.uuid4()}@noemail.com"
        cargo = "Particular"
        institucion = "Ciudadano"
        grado = "Ciudadano"
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
    return JSONResponse([{"id": key, "nombre": val["nombre"]} for key, val in matriz.items()])

@app.get("/api/item/{numero}")
async def get_item(numero: int, lang: str = "es-VE"):
    titulos = {
        "es-VE": {
            1: "Marco Normativo y Barreras Físico-Estructurales",
            2: "Percepción de Amenazas y Paradoja de la Inacción",
            3: "Resistencia, Saberes Comunitarios y Corresponsabilidad",
            4: "Alianzas Público-Privadas y Viabilidad Económica",
            5: "Cibernética, Homeostasis e Integración OT/IT",
            6: "Subsuelo Productivo y Soberanía Alimentaria",
            7: "Epistemología y Producción de Conocimiento en Defensa",
            8: "Filtros de Información y Narrativas Estratégicas",
            9: "Cultura Organizacional y Resistencia al Cambio",
            10: "Articulación Interinstitucional y Coordinación",
            11: "El Rol Estratégico de la FANB en la Praxis Soterrada",
            12: "Prospectiva, Escenarios y Recomendaciones de Futuro"
        }
    }
    return JSONResponse({"titulo": titulos.get(lang, titulos["es-VE"]).get(numero, f"Ítem {numero}")})

@app.get("/api/audio/{tipo}/{numero}")
async def get_audio(tipo: str, numero: int):
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
    textos = {
        "es-VE": f"Pregunta número {numero} en español de Venezuela.",
        "es-ES": f"Pregunta número {numero} en español de España.",
        "en-US": f"Question number {numero} in English.",
        "pt-BR": f"Pergunta número {numero} em português."
    }
    return JSONResponse({"texto": textos.get(lang, textos["es-VE"])})

@app.post("/api/respuesta")
async def guardar_respuesta(
    background_tasks: BackgroundTasks,
    sessionId: str = Form(...),
    itemIdx: int = Form(...),
    subIdx: int = Form(...),
    transcripcion: str = Form(...),
    perfil: str = Form(...),
    lang: str = Form("es-VE"),
    audio: Optional[UploadFile] = File(None)
):
    if not transcripcion.strip() and audio is None:
        raise HTTPException(422, "Respuesta vacía")
    audio_path = None
    if audio:
        audio_path = f"/data/audios_respuestas/{sessionId}_{itemIdx}_{subIdx}_audio.webm"
        async with aiofiles.open(audio_path, 'wb') as f:
            await f.write(await audio.read())
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''INSERT INTO respuestas 
                 (sesion_id, item_idx, sub_idx, audio_path, transcripcion, lang, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)''',
              (sessionId, itemIdx, subIdx, audio_path, transcripcion, lang, datetime.datetime.now()))
    respuesta_id = c.lastrowid
    conn.commit()
    conn.close()
    background_tasks.add_task(sincronizar_respuesta, respuesta_id)
    return JSONResponse({
        "status": "saved",
        "respuesta_id": respuesta_id,
        "sync_status": "queued"
    })

@app.get("/api/admin/dashboard")
async def dashboard():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM respuestas")
    total_respuestas = c.fetchone()[0]
    c.execute("SELECT COUNT(DISTINCT sesion_id) FROM respuestas")
    total_sesiones = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM respuestas WHERE sync_status = 'pending' OR sync_status = 'failed'")
    videos_pendientes = c.fetchone()[0]
    conn.close()
    return JSONResponse({
        "totalRespuestas": total_respuestas,
        "totalSesiones": total_sesiones,
        "videosPendientes": videos_pendientes
    })

@app.post("/api/admin/sincronizar_videos")
async def sincronizar_videos():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''SELECT id FROM respuestas WHERE sync_status = 'pending' OR sync_status = 'failed' LIMIT 100''')
    pendientes = [row[0] for row in c.fetchall()]
    conn.close()
    for pid in pendientes:
        try:
            sincronizar_respuesta(pid)
        except:
            pass
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''SELECT COUNT(*) FROM respuestas WHERE sync_status = 'pending' OR sync_status = 'failed' ''')
    restantes = c.fetchone()[0]
    conn.close()
    return JSONResponse({
        "mensaje": f"Procesados {len(pendientes)} registros. Pendientes: {restantes}."
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)