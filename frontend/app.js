// app.js - Versión final con eventos táctiles y de mouse separados
const API_BASE = 'https://backend-iaesen-final.onrender.com/api';

let state = {
    role: null,
    sessionId: null,
    perfil: null,
    items: [],
    currentItemIdx: 0,
    currentSubIdx: 0,
    answers: {},
    textoManual: '',
    transcripcion: '',
    tieneAudio: false,
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    isPlaying: false,
    recognition: null,
    isRecognizing: false,
    stream: null
};

function mostrarMenu() {
    document.getElementById('view-portada').classList.add('hidden');
    document.getElementById('view-home').classList.remove('hidden');
}

function showView(viewId) {
    document.querySelectorAll('.app-container > div[id^="view-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

function goHome() {
    mostrarMenu();
}

function selectRole(role) {
    state.role = role;
    if (role === 'no_experto') {
        showView('view-no-experto');
    } else if (role === 'experto') {
        cargarPerfiles();
        showView('view-experto');
    }
}

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

async function iniciarEntrevistaExperto() {
    const perfil = document.getElementById('perfil-experto').value;
    const nombre = document.getElementById('nombre').value;
    const email = document.getElementById('email').value;
    const cargo = document.getElementById('cargo').value;
    const institucion = document.getElementById('institucion').value;
    const grado = document.getElementById('grado').value;

    if (!perfil || !nombre || !email || !cargo) {
        mostrarStatus('Por favor complete todos los campos requeridos.', 'error');
        return;
    }

    state.perfil = perfil;

    try {
        const formData = new FormData();
        formData.append('role', 'experto');
        formData.append('perfil', perfil);
        formData.append('nombre', nombre);
        formData.append('email', email);
        formData.append('cargo', cargo);
        formData.append('institucion', institucion);
        formData.append('grado', grado);

        const res = await fetch(`${API_BASE}/sesion`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error(`Error ${res.status}`);
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

async function iniciarEntrevistaNoExperto() {
    try {
        const formData = new FormData();
        formData.append('role', 'no_experto');

        const res = await fetch(`${API_BASE}/sesion`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error(`Error ${res.status}`);
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

async function cargarPregunta() {
    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    const itemNum = state.items[itemIdx];
    const globalIdx = (itemIdx * 3) + subIdx + 1;

    // 🔁 VERIFICAR SI YA HAY UNA RESPUESTA GUARDADA PARA ESTA PREGUNTA
    const key = `${itemIdx}_${subIdx}`;
    const respuestaGuardada = state.answers[key] || '';

    state.textoManual = '';
    state.transcripcion = '';
    state.tieneAudio = false;
    state.isRecognizing = false;
    state.isRecording = false;

    document.getElementById('btn-record').disabled = true;
    document.getElementById('btn-play-response').disabled = true;
    document.getElementById('btn-confirmar').disabled = true;
    document.getElementById('btn-anterior').disabled = (itemIdx === 0 && subIdx === 0);
    document.getElementById('btn-siguiente').disabled = false;

    const ca = document.getElementById('context-audio'); ca.pause(); ca.removeAttribute('src'); ca.load();
    const tb = document.getElementById('transcription-box');

    // ✅ MOSTRAR LA RESPUESTA GUARDADA SI EXISTE
    tb.value = respuestaGuardada;
    tb.placeholder = respuestaGuardada ? '' : 'Verifique y corrija su respuesta acá si es necesario...';

    if (state.role === 'experto' && subIdx === 0) {
        try {
            const res = await fetch(`${API_BASE}/item/${itemNum}`);
            const data = await res.json();
            document.getElementById('instruction-text').innerHTML = `
                <strong>Ítem ${itemNum}:</strong> ${data.titulo}.<br>
                Escuche el contexto y luego responda las preguntas.
            `;
        } catch (e) {
            document.getElementById('instruction-text').textContent = `Ítem ${itemNum}: Cargando...`;
        }
        const itemAudio = `${API_BASE}/audio/item/${itemNum}`;
        document.getElementById('context-audio').src = itemAudio;
        document.getElementById('context-audio').load();
        const player = document.getElementById('context-audio');
        player.onended = () => {
            cargarPreguntaReal(itemNum, subIdx, globalIdx);
        };
        player.onerror = () => {
            if (!player.getAttribute('src')) return;
            console.error('No se pudo cargar el audio del ítem:', player.src);
            mostrarStatus('No se pudo cargar el audio de contexto. Continuando con la pregunta...', 'error');
            cargarPreguntaReal(itemNum, subIdx, globalIdx);
        };
        return;
    }

    cargarPreguntaReal(itemNum, subIdx, globalIdx);
}

async function cargarPreguntaReal(itemNum, subIdx, globalIdx) {
    const audioUrl = `${API_BASE}/audio/pregunta/${globalIdx}`;
    document.getElementById('context-audio').src = audioUrl;
    document.getElementById('context-audio').load();

    try {
        const res = await fetch(`${API_BASE}/pregunta/${globalIdx}`);
        const data = await res.json();
        const totalPreguntas = state.items.length * 3;
        document.getElementById('instruction-text').innerHTML = data.texto.replace(
            /Pregunta número \d+/,
            `Pregunta Número ${globalIdx} de ${totalPreguntas}`
        );
    } catch (e) {
        const totalPreguntas = state.items.length * 3;
        document.getElementById('instruction-text').textContent = `Pregunta Número ${globalIdx} de ${totalPreguntas}`;
    }

    const player = document.getElementById('context-audio');
    player.onended = () => {
        state.isPlaying = false;
        document.getElementById('btn-record').disabled = false;
        document.getElementById('btn-play-response').disabled = false;
        document.getElementById('btn-confirmar').disabled = false;
        mostrarStatus('Pregunta terminada. Puede grabar o escribir su respuesta.', 'info');
    };
    player.onerror = () => {
        if (!player.getAttribute('src')) return;
        console.error('No se pudo cargar el audio de la pregunta:', player.src);
        document.getElementById('btn-record').disabled = false;
        document.getElementById('btn-play-response').disabled = false;
        document.getElementById('btn-confirmar').disabled = false;
        mostrarStatus('No se pudo cargar el audio. Puede leer la pregunta y responder igualmente.', 'error');
    };

    actualizarHexagono();
    mostrarStatus('', '');
}

function actualizarHexagono() {
    const hexLabel = document.getElementById('hex-label-text');
    const itemNum = state.currentItemIdx + 1;
    const subNum = state.currentSubIdx + 1;
    const sufijos = ['RA', 'DA', 'RA'];
    hexLabel.textContent = `${subNum}${sufijos[subNum-1]} PREGUNTA`;
    for (let i = 1; i <= 6; i++) {
        const side = document.getElementById(`side-${i}`);
        side.classList.toggle('active', i === itemNum);
    }
}

// ------------------------------------------------------------------
// GRABACIÓN ESTILO "MANTENER PRESIONADO" (Eventos separados)
// ------------------------------------------------------------------
let isPressing = false;

// Soporte para celular (táctil)
document.getElementById('btn-record').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (isPressing) return;
    isPressing = true;
    startRecording();
});

document.getElementById('btn-record').addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!isPressing) return;
    isPressing = false;
    stopRecording();
});

// Soporte para PC (mouse)
document.getElementById('btn-record').addEventListener('mousedown', (e) => {
    if (isPressing) return;
    isPressing = true;
    startRecording();
});

document.getElementById('btn-record').addEventListener('mouseup', (e) => {
    if (!isPressing) return;
    isPressing = false;
    stopRecording();
});

document.getElementById('btn-record').addEventListener('mouseleave', (e) => {
    if (isPressing) {
        isPressing = false;
        stopRecording();
    }
});

async function startRecording() {
    try {
        const constraints = { audio: true };
        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.mediaRecorder = new MediaRecorder(state.stream);
        state.audioChunks = [];

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) state.audioChunks.push(e.data);
        };

        // INICIAR RECONOCIMIENTO ANTES DE QUE EL MEDIA RECORDER EMPIECE A GRABAR
        iniciarReconocimiento();

        state.mediaRecorder.start();
        state.isRecording = true;
        document.getElementById('btn-record').classList.add('recording');
        document.getElementById('record-text').innerText = "grabando...";
        document.getElementById('vu-meter').classList.add('active');
        mostrarStatus('Grabando...', 'success');

        state.mediaRecorder.onstop = () => {
            const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
            state.tieneAudio = true;
            document.getElementById('btn-play-response').disabled = false;
            document.getElementById('vu-meter').classList.remove('active');
        };
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            mostrarStatus('Permiso de micrófono denegado.', 'error');
        } else {
            mostrarStatus('Error al iniciar la grabación.', 'error');
        }
    }
}

function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }
    state.isRecording = false;
    document.getElementById('btn-record').classList.remove('recording');
    document.getElementById('record-text').innerText = "grabar su opinión";
    mostrarStatus('Grabación finalizada.', 'success');
    document.getElementById('vu-meter').classList.remove('active');

    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
}

function iniciarReconocimiento() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        mostrarStatus('Este navegador no soporta reconocimiento de voz.', 'error');
        return;
    }

    const idiomas = ['es-VE', 'es-419', 'es-ES'];
    let lang = idiomas.find(l => {
        try {
            const test = new SpeechRecognition();
            test.lang = l;
            return true;
        } catch (e) {
            return false;
        }
    }) || 'es-ES';

    state.recognition = new SpeechRecognition();
    state.recognition.lang = lang;
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.maxAlternatives = 1;

    state.recognition.onstart = () => {
        state.isRecognizing = true;
        console.log('Reconocimiento iniciado con idioma:', lang);
    };

    state.recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalChunk += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        if (finalChunk) {
            state.transcripcion = (state.transcripcion || '') + ' ' + finalChunk.trim();
        }

        const tb = document.getElementById('transcription-box');
        if (!tb) return;

        const textoActual = (state.transcripcion || '').trim();
        const textoCompleto = interimTranscript 
            ? `${textoActual} ${interimTranscript}`.trim() 
            : textoActual;

        tb.value = textoCompleto;
        tb.scrollTop = tb.scrollHeight;
    };

    state.recognition.onerror = (event) => {
        console.error('SpeechRecognition error:', event.error, event.message);
        const mensajes = {
            'not-allowed': 'El navegador bloqueó el acceso al reconocimiento de voz.',
            'audio-capture': 'No se detectó un micrófono disponible.',
            'no-speech': 'No se detectó voz.',
            'network': 'El servicio de reconocimiento no está disponible.',
            'language-not-supported': 'El idioma seleccionado no es compatible.'
        };
        mostrarStatus(mensajes[event.error] || `Error desconocido: ${event.error}`, 'error');
    };

    state.recognition.onend = () => {
        state.isRecognizing = false;
        console.log('Reconocimiento finalizado');
    };

    state.recognition.start();
}

function playResponse() {
    if (state.audioChunks.length === 0) {
        mostrarStatus('No hay respuesta grabada para reproducir.', 'error');
        return;
    }
    const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
}

async function confirmarEnvio() {
    if (state.isRecording) {
        mostrarStatus('Por favor detenga la grabación antes de confirmar.', 'error');
        return;
    }
    const respuesta = document.getElementById('transcription-box').value.trim();
    if (!respuesta && !state.tieneAudio) {
        mostrarStatus('Debe escribir o grabar una respuesta antes de confirmar.', 'error');
        return;
    }
    const guardado = await guardarRespuesta(respuesta);
    if (!guardado) {
        mostrarStatus('No se pudo guardar la respuesta.', 'error');
        return;
    }
    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    if (subIdx < 2) {
        state.currentSubIdx++;
    } else if (itemIdx < state.items.length - 1) {
        state.currentItemIdx++;
        state.currentSubIdx = 0;
    } else {
        mostrarStatus('🎉 Entrevista completada. ¡Gracias por participar!', 'success');
        document.getElementById('btn-confirmar').disabled = true;
        document.getElementById('btn-siguiente').disabled = true;
        return;
    }
    cargarPregunta();
    mostrarStatus('', '');
}

async function navegar(direccion) {
    if (state.isRecording) {
        mostrarStatus('Por favor detenga la grabación antes de avanzar.', 'error');
        return;
    }
    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    if (direccion === 1) {
        if (subIdx < 2) {
            state.currentSubIdx++;
            cargarPregunta();
        } else if (itemIdx < state.items.length - 1) {
            state.currentItemIdx++;
            state.currentSubIdx = 0;
            cargarPregunta();
        } else {
            mostrarStatus('Ya está en la última pregunta.', 'info');
        }
    } else if (direccion === -1) {
        if (subIdx > 0) {
            state.currentSubIdx--;
            cargarPregunta();
        } else if (itemIdx > 0) {
            state.currentItemIdx--;
            state.currentSubIdx = 2;
            cargarPregunta();
        } else {
            mostrarStatus('Ya está en la primera pregunta.', 'info');
        }
    }
    mostrarStatus('', '');
}

async function guardarRespuesta(respuesta) {
    // Guardar la respuesta en el estado local para poder mostrarla al retroceder
    const key = `${state.currentItemIdx}_${state.currentSubIdx}`;
    state.answers[key] = respuesta;

    const formData = new FormData();
    formData.append('sessionId', state.sessionId);
    formData.append('itemIdx', state.currentItemIdx);
    formData.append('subIdx', state.currentSubIdx);
    formData.append('transcripcion', respuesta);
    formData.append('perfil', state.role);
    if (state.audioChunks.length > 0) {
        const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
        formData.append('audio', blob, 'respuesta.webm');
    }
    try {
        const res = await fetch(`${API_BASE}/respuesta`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.audioChunks = [];
        return true;
    } catch (e) {
        console.error('Error al guardar la respuesta:', e);
        return false;
    }
}

function mostrarStatus(msg, type) {
    const el = document.getElementById('status-msg');
    if (!msg) { el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.className = 'status-msg ' + (type || '');
    el.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('view-portada').classList.remove('hidden');
});