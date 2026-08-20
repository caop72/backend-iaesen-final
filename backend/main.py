import os
import sqlite3
import uuid
import json
import datetime
import asyncio
import logging
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import aiofiles
from typing import Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Configuración de logging para ver errores en Render
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn.error")

app = FastAPI()

# ----------------- CONFIGURACIÓN CORS SEGURA -----------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://caop72.github.io", 
        "https://backend-iaesen-final.onrender.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- RUTAS DE ARCHIVOS Y BASE DE DATOS -----------------
# RUTA ABSOLUTA PARA RENDER CON DISCO MONTADO
AUDIO_BASE = "/opt/render/project/src/backend/audios"
DB_PATH = "entrevistas.db"

# Crear carpeta de audios si no existe (para respuestas de usuario)
AUDIO_RESPUESTAS_DIR = "/opt/render/project/src/backend/audios_respuestas"
os.makedirs(AUDIO_RESPUESTAS_DIR, exist_ok=True)

# ----------------- FUNCIONES DE BASE DE DATOS -----------------
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
        sync_status TEXT DEFAULT 'pendiente',
        sync_attempts INTEGER DEFAULT 0,
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

# ----------------- FUNCIONES DE GOOGLE SHEETS -----------------
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

def procesar_sincronizacion_unitaria(respuesta_id: int):
    """Función síncrona bloqueante para ejecutar dentro del worker"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Obtener datos de la respuesta
    c.execute('''SELECT s.nombre, s.email, s.grado, s.cargo, s.institucion, s.perfil,
                        r.item_idx, r.sub_idx, r.transcripcion, r.created_at
                 FROM respuestas r
                 JOIN sesiones s ON r.sesion_id = s.id
                 WHERE r.id = ?''', (respuesta_id,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        return False, "No se encontró la respuesta o sesión"
    
    nombre, email, grado, cargo, institucion, perfil, item_idx, sub_idx, transcripcion, created_at = row
    
    try:
        service = obtener_servicio_sheets()
        sheet_id = "1GJYdj0DK2U_FGMqHvt4QrOPOHrvWLb1TcjsbQ4NcIkY"
        sheet_metadata = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        sheet_name = sheet_metadata['sheets'][0]['properties']['title']
        
        codigo = f"P{item_idx + 1}"
        ambito = "Seguridad de la Nación"
        
        valores = [[
            nombre or "",
            email or "",
            grado or "",
            cargo or "",
            institucion or "",
            perfil or "",
            codigo,
            ambito,
            "Técnica-Cibernética",
            item_idx + 1,
            f"Pregunta {item_idx + 1}",
            transcripcion or "",
            created_at.isoformat() if created_at else datetime.datetime.now().isoformat()
        ]]
        
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range=f"{sheet_name}!A:M",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": valores}
        ).execute()
        
        return True, None
    except Exception as e:
        return False, str(e)

# ----------------- ENDPOINTS PÚBLICOS (RÁPIDOS) -----------------

@app.get("/")
async def root():
    return {"mensaje": "API IAESEN funcionando"}

@app.post("/api/sesion")
async def crear_sesion(
    role: str = Form(...), 
    perfil: Optional[str] = Form(None), 
    nombre: Optional[str] = Form(None), 
    email: Optional[str] = Form(None),
    cargo: Optional[str] = Form(None), 
    institucion: Optional[str] = Form(None),
    grado: Optional[str] = Form(None), 
    lang: str = Form("es-VE")
):
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
    sessionId: str = Form(...),
    itemIdx: int = Form(...),
    subIdx: int = Form(...),
    transcripcion: str = Form(default=""),
    perfil: str = Form(...),
    audio: Optional[UploadFile] = File(None)
):
    if not transcripcion.strip() and audio is None:
        raise HTTPException(422, "Debe proporcionar transcripción o audio")
    
    if not transcripcion.strip():
        transcripcion = "[Respuesta de voz]"
    
    audio_path = None
    if audio:
        audio_path = os.path.join(AUDIO_RESPUESTAS_DIR, f"{sessionId}_{itemIdx}_{subIdx}_audio.webm")
        async with aiofiles.open(audio_path, 'wb') as f:
            await f.write(await audio.read())

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''INSERT INTO respuestas 
                 (sesion_id, item_idx, sub_idx, audio_path, transcripcion, lang, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)''',
              (sessionId, itemIdx, subIdx, audio_path, transcripcion, "es-VE", datetime.datetime.now()))
    respuesta_id = c.lastrowid
    conn.commit()
    conn.close()

    # RESPUESTA INMEDIATA. NADA DE SINCRONIZACIÓN AQUÍ.
    return JSONResponse({
        "status": "saved",
        "respuesta_id": respuesta_id,
        "sync_status": "pendiente"
    })

@app.get("/api/admin/dashboard")
async def dashboard():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM respuestas")
    total_respuestas = c.fetchone()[0]
    c.execute("SELECT COUNT(DISTINCT sesion_id) FROM respuestas")
    total_sesiones = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM respuestas WHERE sync_status = 'pendiente' OR sync_status = 'error_reintentando'")
    videos_pendientes = c.fetchone()[0]
    conn.close()
    return JSONResponse({
        "totalRespuestas": total_respuestas,
        "totalSesiones": total_sesiones,
        "videosPendientes": videos_pendientes
    })

# ----------------- ENDPOINT DE SINCRONIZACIÓN POR LOTE (Cron) -----------------
# AHORA SIN CLAVE INVENTADA, SOLO USA GOOGLE_CREDENTIALS_JSON
@app.post("/api/admin/procesar-pendientes")
async def procesar_pendientes():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('''SELECT id FROM respuestas 
                 WHERE sync_status = 'pendiente' OR sync_status = 'error_reintentando'
                 ORDER BY created_at ASC LIMIT 10''') # Lote pequeño para evitar timeouts
    pendientes = [row[0] for row in c.fetchall()]
    conn.close()
    
    resultados = {"procesados": 0, "exitosos": 0, "fallidos": 0}
    
    for resp_id in pendientes:
        resultados["procesados"] += 1
        exito, error = procesar_sincronizacion_unitaria(resp_id)
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        if exito:
            c.execute('''UPDATE respuestas SET sync_status = 'sincronizado', sync_error = NULL, sync_attempts = 0, synced_at = ? WHERE id = ?''',
                      (datetime.datetime.now().isoformat(), resp_id))
            resultados["exitosos"] += 1
        else:
            c.execute('''UPDATE respuestas SET sync_status = 'error_reintentando', sync_error = ?, sync_attempts = sync_attempts + 1 WHERE id = ?''',
                      (error, resp_id))
            resultados["fallidos"] += 1
            logger.error(f"Fallo sincronización ID {resp_id}: {error}")
        conn.commit()
        conn.close()
    
    return JSONResponse({
        "ok": True,
        "resumen": resultados,
        "mensaje": f"Procesados: {resultados['procesados']}. Exitosos: {resultados['exitosos']}. Fallidos: {resultados['fallidos']}."
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)