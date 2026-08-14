// app.js - Motor de la PWA (Vanilla JS + FSM)
const API_BASE = 'https://tu-backend.onrender.com/api'; // CAMBIAR POR URL REAL DEL BACKEND

let state = {
    role: null,
    sessionId: null,
    lang: 'es-VE',
    perfil: null,
    items: [],
    currentItemIdx: 0,
    currentSubIdx: 0,
    answers: {},
    mediaRecorder: null,
    audioChunks: [],
    videoChunks: [],
    isRecording: false,
    transcription: '',
    useVideo: false,
    stream: null
};

// ------------------------------------------------------------------
// SELECTOR DE IDIOMA
// ------------------------------------------------------------------
document.getElementById('lang-selector').addEventListener('change', (e) => {
    state.lang = e.target.value;
    console.log('Idioma seleccionado:', state.lang);
});

// ------------------------------------------------------------------
// NAVEGACIÓN ENTRE VISTAS
// ------------------------------------------------------------------
function showView(viewId) {
    document.querySelectorAll('.app-container > div[id^="view-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

function goHome() {
    showView('view-home');
}

// ------------------------------------------------------------------
// SELECCIÓN DE ROL (TARJETAS)
// ------------------------------------------------------------------
function selectRole(role) {
    state.role = role;
    if (role === 'no_experto') {
        showView('view-no-experto');
    } else if (role === 'experto') {
        cargarPerfiles();
        showView('view-experto');
    } else if (role === 'investigador') {
        showView('view-investigador');
    }
}

// ------------------------------------------------------------------
// CARGA DE PERFILES DE EXPERTOS (DESDE LA API)
// ------------------------------------------------------------------
async function cargarPerfiles() {
    try {
        const res = await fetch(`${API_BASE}/perfiles`);
        const data = await res.json();
        const sel = document.getElementById('perfil-experto');
        data.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nombre;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('Error cargando perfiles:', e);
    }
}

document.getElementById('perfil-experto').addEventListener('change', (e) => {
    if (e.target.value) {
        document.getElementById('experto-datos').classList.remove('hidden');
    } else {
        document.getElementById('experto-datos').classList.add('hidden');
    }
});

// ------------------------------------------------------------------
// INICIO DE ENTREVISTA (EXPERTO)
// ------------------------------------------------------------------
async function iniciarEntrevistaExperto() {
    const perfil = document.getElementById('perfil-experto').value;
    const nombre = document.getElementById('nombre').value;
    const email = document.getElementById('email').value;
    const cargo = document.getElementById('cargo').value;
    const institucion = document.getElementById('institucion').value;
    const grado = document.getElementById('grado').value;
    const useVideo = document.getElementById('opcion-video').value === 'si';

    if (!perfil || !nombre || !email || !cargo) {
        mostrarStatus('Por favor complete todos los campos requeridos.', 'error');
        return;
    }

    state.useVideo = useVideo;
    state.perfil = perfil;
    state.lang = document.getElementById('lang-selector').value;

    try {
        const res = await fetch(`${API_BASE}/sesion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'experto', perfil, nombre, email, cargo, institucion, grado, lang: state.lang })
        });
        const data = await res.json();
        state.sessionId = data.sessionId;
        state.items = data.items;
        state.currentItemIdx = 0;
        state.currentSubIdx = 0;
        showView('view-entrevista');
        cargarPregunta();
    } catch (e) {
        mostrarStatus('Error al iniciar la entrevista.', 'error');
    }
}

// ------------------------------------------------------------------
// INICIO DE ENTREVISTA (NO EXPERTO)
// ------------------------------------------------------------------
async function iniciarEntrevistaNoExperto() {
    state.useVideo = false;
    state.lang = document.getElementById('lang-selector').value;
    try {
        const res = await fetch(`${API_BASE}/sesion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'no_experto', lang: state.lang })
        });
        const data = await res.json();
        state.sessionId = data.sessionId;
        state.items = data.items;
        state.currentItemIdx = 0;
        state.currentSubIdx = 0;
        showView('view-entrevista');
        cargarPregunta();
    } catch (e) {
        mostrarStatus('Error al iniciar la entrevista.', 'error');
    }
}

// ------------------------------------------------------------------
// CARGA DE PREGUNTA Y AUDIOS
// ------------------------------------------------------------------
async function cargarPregunta() {
    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    const itemNum = state.items[itemIdx];
    const globalIdx = (itemIdx * 3) + subIdx + 1;

    document.getElementById('audio-player').src = '';
    document.getElementById('audio-section').classList.remove('hidden');
    document.getElementById('video-section').classList.add('hidden');

    // Cargar audio de la pregunta
    const audioUrl = `${API_BASE}/audio/pregunta/${globalIdx}`;
    document.getElementById('audio-player').src = audioUrl;
    document.getElementById('audio-player').load();

    // Si es experto y es la primera pregunta del ítem, cargar el previo (i#.mp3)
    if (state.role === 'experto' && subIdx === 0) {
        const itemAudio = `${API_BASE}/audio/item/${itemNum}`;
        document.getElementById('audio-player').src = itemAudio;
        document.getElementById('audio-player').load();
        // Se reproducirá el previo y luego la pregunta
    }

    // Cargar texto de la pregunta
    const res = await fetch(`${API_BASE}/pregunta/${globalIdx}?lang=${state.lang}`);
    const data = await res.json();
    document.getElementById('pregunta-texto').textContent = data.texto;

    // Actualizar progreso
    actualizarProgreso();
    document.getElementById('transcription-box').value = '';
    document.getElementById('btn-grabar').disabled = false;
    document.getElementById('btn-detener').disabled = true;
    document.getElementById('btn-anterior').disabled = (itemIdx === 0 && subIdx === 0);
}

// ------------------------------------------------------------------
// ACTUALIZACIÓN DE PROGRESO
// ------------------------------------------------------------------
function actualizarProgreso() {
    const container = document.getElementById('progress-steps');
    container.innerHTML = '';
    state.items.forEach((item, idx) => {
        const step = document.createElement('span');
        step.className = 'step';
        if (idx < state.currentItemIdx) step.classList.add('done');
        if (idx === state.currentItemIdx) step.classList.add('active');
        step.textContent = `Ítem ${item}`;
        container.appendChild(step);
    });
}

// ------------------------------------------------------------------
// GRABACIÓN DE AUDIO / VIDEO
// ------------------------------------------------------------------
async function toggleRecording() {
    if (state.isRecording) {
        stopRecording();
        return;
    }
    await startRecording();
}

async function startRecording() {
    try {
        const constraints = state.useVideo ? { audio: true, video: true } : { audio: true };
        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.mediaRecorder = new MediaRecorder(state.stream);
        state.audioChunks = [];
        state.videoChunks = [];

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                if (state.useVideo) {
                    state.videoChunks.push(e.data);
                } else {
                    state.audioChunks.push(e.data);
                }
            }
        };

        state.mediaRecorder.onstop = () => {
            if (state.useVideo) {
                const blob = new Blob(state.videoChunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                document.getElementById('video-preview').src = url;
                document.getElementById('video-section').classList.remove('hidden');
                document.getElementById('video-preview').play();
            } else {
                const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                // Opcional: reproducir audio para revisión
            }
        };

        state.mediaRecorder.start();
        state.isRecording = true;
        document.getElementById('btn-grabar').textContent = '⏹ Detener grabación';
        document.getElementById('btn-grabar').classList.remove('btn-primary');
        document.getElementById('btn-grabar').classList.add('btn-red');
        document.getElementById('btn-detener').disabled = false;
        mostrarStatus('Grabando...', 'success');
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            mostrarStatus('Permiso de micrófono/cámara denegado. Revise la configuración de su navegador.', 'error');
        } else {
            mostrarStatus('Error al iniciar la grabación.', 'error');
        }
    }
}

function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
        state.isRecording = false;
        document.getElementById('btn-grabar').textContent = '🎙️ Grabar respuesta';
        document.getElementById('btn-grabar').classList.remove('btn-red');
        document.getElementById('btn-grabar').classList.add('btn-primary');
        document.getElementById('btn-detener').disabled = true;
        mostrarStatus('Grabación finalizada.', 'success');
    }
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
}

// ------------------------------------------------------------------
// NAVEGACIÓN ENTRE PREGUNTAS
// ------------------------------------------------------------------
async function navegar(direccion) {
    if (state.isRecording) {
        mostrarStatus('Por favor detenga la grabación antes de avanzar.', 'error');
        return;
    }

    const respuesta = document.getElementById('transcription-box').value;
    if (!respuesta.trim()) {
        mostrarStatus('Por favor escriba o grabe una respuesta antes de continuar.', 'error');
        return;
    }

    // Guardar respuesta
    await guardarRespuesta(respuesta);

    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;

    if (direccion === 1) {
        if (subIdx < 2) {
            state.currentSubIdx++;
        } else if (itemIdx < state.items.length - 1) {
            state.currentItemIdx++;
            state.currentSubIdx = 0;
        } else {
            mostrarStatus('🎉 Entrevista completada. ¡Gracias por participar!', 'success');
            document.getElementById('btn-siguiente').disabled = true;
            return;
        }
    } else if (direccion === -1) {
        if (subIdx > 0) {
            state.currentSubIdx--;
        } else if (itemIdx > 0) {
            state.currentItemIdx--;
            state.currentSubIdx = 2;
        } else {
            return;
        }
    }

    cargarPregunta();
    mostrarStatus('', '');
}

// ------------------------------------------------------------------
// GUARDAR RESPUESTA EN LA API
// ------------------------------------------------------------------
async function guardarRespuesta(respuesta) {
    const formData = new FormData();
    formData.append('sessionId', state.sessionId);
    formData.append('itemIdx', state.currentItemIdx);
    formData.append('subIdx', state.currentSubIdx);
    formData.append('transcripcion', respuesta);
    formData.append('perfil', state.role);
    formData.append('lang', state.lang);

    // Adjuntar audio o video si se grabó
    if (state.useVideo && state.videoChunks.length > 0) {
        const blob = new Blob(state.videoChunks, { type: 'video/webm' });
        formData.append('video', blob, 'respuesta.webm');
    } else if (state.audioChunks.length > 0) {
        const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
        formData.append('audio', blob, 'respuesta.webm');
    }

    try {
        const res = await fetch(`${API_BASE}/respuesta`, {
            method: 'POST',
            body: formData
        });
        if (!res.ok) throw new Error('Error al guardar');
        state.audioChunks = [];
        state.videoChunks = [];
    } catch (e) {
        mostrarStatus('Error al guardar la respuesta.', 'error');
    }
}

// ------------------------------------------------------------------
// MENSAJES DE ESTADO
// ------------------------------------------------------------------
function mostrarStatus(msg, type) {
    const el = document.getElementById('status-msg');
    if (!msg) {
        el.classList.add('hidden');
        return;
    }
    el.textContent = msg;
    el.className = 'status-msg ' + (type || '');
    el.classList.remove('hidden');
}

// ------------------------------------------------------------------
// PANEL DE INVESTIGADOR
// ------------------------------------------------------------------
async function accederDashboard() {
    const clave = document.getElementById('clave-investigador').value;
    if (clave !== '5656') {
        mostrarStatus('Clave incorrecta.', 'error');
        return;
    }
    document.getElementById('dashboard-content').classList.remove('hidden');
    await cargarDashboard();
}

async function cargarDashboard() {
    try {
        const res = await fetch(`${API_BASE}/admin/dashboard`);
        const data = await res.json();
        document.getElementById('dashboard-stats').innerHTML = `
            <p><strong>Total respuestas:</strong> ${data.totalRespuestas}</p>
            <p><strong>Total sesiones:</strong> ${data.totalSesiones}</p>
            <p><strong>Videos pendientes:</strong> ${data.videosPendientes}</p>
        `;
    } catch (e) {
        document.getElementById('dashboard-stats').textContent = 'Error cargando datos.';
    }
}

async function sincronizarVideos() {
    const btn = document.querySelector('button[onclick="sincronizarVideos()"]');
    btn.disabled = true;
    btn.textContent = '⏳ Sincronizando...';
    try {
        const res = await fetch(`${API_BASE}/admin/sincronizar_videos`, { method: 'POST' });
        const data = await res.json();
        document.getElementById('sync-status').textContent = data.mensaje;
        document.getElementById('sync-status').className = 'status-msg success';
        document.getElementById('sync-status').classList.remove('hidden');
        await cargarDashboard();
    } catch (e) {
        document.getElementById('sync-status').textContent = 'Error al sincronizar.';
        document.getElementById('sync-status').className = 'status-msg error';
        document.getElementById('sync-status').classList.remove('hidden');
    }
    btn.disabled = false;
    btn.textContent = '🔁 Sincronizar videos pendientes';
}

// ------------------------------------------------------------------
// INICIALIZACIÓN
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    showView('view-home');
});