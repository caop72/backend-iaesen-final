// app.js - FINAL COMPLETO: Estrellitas, texto en vivo, no bloqueo de confirmación
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
    transcripcionFinal: '',
    tieneAudio: false,
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    isPlaying: false,
    recognition: null,
    isRecognizing: false,
    stream: null,
    touchStarted: false,
    mouseStarted: false,
    recordingStartTime: 0,
    recordingTimer: null,
    audioEscuchadoEnPreguntaActual: false
};

// --- VARIABLES PARA GUARDADO LOCAL ---
let respuestasLocales = [];
let entrevistaFinalizada = false;
let lastSyncError = false;
let pendingRetry = null;

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
    if (role === 'experto') {
        cargarPerfiles();
        showView('view-experto');
    } else if (role === 'no_experto') {
        iniciarEntrevistaNoExperto(); // Se inicia inmediatamente, sin pantalla intermedia
    }
}

async function cargarPerfiles() {
    try {
        const res = await fetch(`${API_BASE}/perfiles`);
        const data = await res.json();
        const sel = document.getElementById('perfil-experto');
        sel.innerHTML = '<option value="">-- Seleccione --</option>';
        data.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nombre;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('Error cargando perfiles:', e);
        mostrarStatus('Error al cargar perfiles', 'error');
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
    const nombre = document.getElementById('nombre').value.trim();
    const email = document.getElementById('email').value.trim();
    const cargo = document.getElementById('cargo').value.trim();
    const institucion = document.getElementById('institucion').value.trim();
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
        state.answers = {};
        respuestasLocales = [];
        entrevistaFinalizada = false;
        
        showView('view-entrevista');
        generarEstrellas();
        cargarPregunta();
    } catch (e) {
        console.error('Error:', e);
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
        state.answers = {};
        respuestasLocales = [];
        entrevistaFinalizada = false;
        
        showView('view-entrevista');
        generarEstrellas();
        cargarPregunta();
    } catch (e) {
        console.error('Error:', e);
        mostrarStatus('Error al iniciar la entrevista.', 'error');
    }
}

// Función para generar las estrellitas de progreso
function generarEstrellas() {
    const container = document.getElementById('progress-stars');
    container.innerHTML = '';
    const totalPreguntas = state.items.length * 3;
    
    // Muestra el total de preguntas
    const label = document.createElement('span');
    label.className = 'total-stars-label';
    label.textContent = `Preguntas: ${totalPreguntas}`;
    label.id = 'total-stars-label';
    container.appendChild(label);
    
    // Crear las estrellas
    for (let i = 0; i < totalPreguntas; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.id = `star-${i}`;
        star.title = `Pregunta ${i + 1}`;
        container.appendChild(star);
    }
}

// Función para updatear el estado de las estrellas basado en el estado del sistema
function actualizarEstrellas() {
    const totalPreguntas = state.items.length * 3;
    
    // Índices de preguntas que ya están respondidas (en el estado local)
    const answeredKeys = Object.keys(state.answers);
    
    for (let i = 0; i < totalPreguntas; i++) {
        const star = document.getElementById(`star-${i}`);
        if (!star) return;
        
        // Transformar índice a clave de respuesta (ej: 0_0, 0_1, 0_2, 1_0...)
        const itemIdx = Math.floor(i / 3);
        const subIdx = i % 3;
        const key = `${itemIdx}_${subIdx}`;
        
        // Si está respondida
        if (answeredKeys.includes(key)) {
            // Si está respondida, pero no sincronizada (puede llevar un icono)
            if (lastSyncError) {
                star.classList.add('pending');
                star.classList.remove('active');
            } else {
                star.classList.add('active');
                star.classList.remove('pending');
            }
        } else {
            star.classList.remove('active');
            star.classList.remove('pending');
        }
    }
}

// Función para updatear el estado de las estrellas con WhatsApp (para el envío)
function actualizarEstrellasSincronizadas(sincronizadas) {
    const totalPreguntas = state.items.length * 3;
    for (let i = 0; i < totalPreguntas; i++) {
        const star = document.getElementById(`star-${i}`);
        if (!star) return;
        
        const itemIdx = Math.floor(i / 3);
        const subIdx = i % 3;
        const key = `${itemIdx}_${subIdx}`;
        
        if (sincronizadas.includes(key)) {
            star.classList.add('active');
            star.classList.remove('pending');
        } else if (state.answers[key]) {
            star.classList.add('pending');
            star.classList.remove('active');
        }
    }
}

function actualizarEstadoIndicador() {
    const indicator = document.getElementById('status-indicator');
    const instruction = document.getElementById('instruction-text');

    if (!indicator) return;

    if (!state.audioEscuchadoEnPreguntaActual) {
        indicator.className = 'status-indicator locked';
        instruction.textContent = '🔴 Por favor escuche el audio antes de responder.';
        document.getElementById('btn-record').disabled = true;
        document.getElementById('btn-confirmar').disabled = true;
        return;
    }

    indicator.className = 'status-indicator ready';
    instruction.textContent = '🟢 Ahora puede grabar su respuesta.';
    document.getElementById('btn-record').disabled = false;
    document.getElementById('btn-confirmar').disabled = false;
}

function cargarPrimeraPreguntaDeItem(itemIdx) {
    const pIndex = itemIdx * 3;
    const audio = document.getElementById('context-audio');
    const itemNum = state.items[itemIdx];

    state.audioEscuchadoEnPreguntaActual = false;
    actualizarEstadoIndicador();

    const previoSrc = `${API_BASE}/audio/item/${itemNum}`;
    audio.src = previoSrc;
    audio.load();
    audio.play().catch(() => {});

    audio.onended = () => {
        const preguntaSrc = `${API_BASE}/audio/pregunta/${pIndex + 1}`;
        audio.src = preguntaSrc;
        audio.load();
        audio.play().catch(() => {});

        audio.onended = () => {
            state.audioEscuchadoEnPreguntaActual = true;
            actualizarEstadoIndicador();
        };
    };
}

async function cargarPregunta() {
    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    const itemNum = state.items[itemIdx];
    const globalIdx = (itemIdx * 3) + subIdx + 1;

    const key = `${itemIdx}_${subIdx}`;
    const respuestaGuardada = state.answers[key] || '';

    if (!respuestaGuardada) {
        state.textoManual = '';
        state.transcripcionFinal = '';
    } else {
        state.transcripcionFinal = respuestaGuardada;
        state.textoManual = respuestaGuardada;
    }
    
    state.tieneAudio = false;
    state.isRecognizing = false;
    state.isRecording = false;
    state.audioEscuchadoEnPreguntaActual = false;

    document.getElementById('btn-record').disabled = true;
    document.getElementById('btn-play-response').disabled = true;
    document.getElementById('btn-confirmar').disabled = true;
    document.getElementById('btn-anterior').disabled = (itemIdx === 0 && subIdx === 0);
    document.getElementById('btn-siguiente').disabled = false;
    document.getElementById('btn-clear').disabled = false;

    const ca = document.getElementById('context-audio');
    ca.pause();
    ca.removeAttribute('src');
    ca.load();
    const tb = document.getElementById('transcription-box');
    tb.value = respuestaGuardada;
    tb.placeholder = respuestaGuardada ? '' : 'Verifique y corrija su respuesta acá si es necesario...';

    const totalPreguntas = state.items.length * 3;
    document.getElementById('question-counter').textContent = `Pregunta Número ${globalIdx} de ${totalPreguntas}`;
    const pct = ((globalIdx) / totalPreguntas) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';

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
        cargarPrimeraPreguntaDeItem(itemIdx);
        return;
    }

    cargarPreguntaReal(itemNum, subIdx, globalIdx);
}

async function cargarPreguntaReal(itemNum, subIdx, globalIdx) {
    const audioUrl = `${API_BASE}/audio/pregunta/${globalIdx}`;
    const player = document.getElementById('context-audio');
    player.src = audioUrl;
    player.load();

    player.play().catch(() => {
        console.warn('Autoplay bloqueado.');
    });

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

    player.onended = () => {
        state.audioEscuchadoEnPreguntaActual = true;
        actualizarEstadoIndicador();
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

function setupRecordButton() {
    const btn = document.getElementById('btn-record');
    
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (state.isRecording || state.touchStarted) return;
        state.touchStarted = true;
        startRecording();
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (state.touchStarted && state.isRecording) {
            state.touchStarted = false;
            stopRecording();
        }
    }, { passive: false });

    btn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        if (state.touchStarted && state.isRecording) {
            state.touchStarted = false;
            stopRecording();
        }
    }, { passive: false });

    btn.addEventListener('mousedown', (e) => {
        if (state.isRecording || state.mouseStarted) return;
        state.mouseStarted = true;
        startRecording();
    });

    btn.addEventListener('mouseup', (e) => {
        if (state.mouseStarted && state.isRecording) {
            state.mouseStarted = false;
            stopRecording();
        }
    });

    btn.addEventListener('mouseleave', (e) => {
        if (state.mouseStarted && state.isRecording) {
            state.mouseStarted = false;
            stopRecording();
        }
    });

    btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function startRecording() {
    try {
        // 1. Detener el reconocimiento anterior si existe
        if (state.recognition && state.isRecognizing) {
            state.recognition.abort();
            state.recognition = null;
        }

        const constraints = { audio: true };
        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.mediaRecorder = new MediaRecorder(state.stream);
        state.audioChunks = [];

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) state.audioChunks.push(e.data);
        };

        state.mediaRecorder.start();
        state.isRecording = true;
        state.recordingStartTime = Date.now();

        document.getElementById('btn-record').classList.add('recording');
        document.getElementById('record-text').innerText = "grabando...";
        document.getElementById('vu-meter').classList.add('active');
        mostrarStatus('🎤 Grabando y escuchando...', 'success');

        // 2. Iniciar reconocimiento con configuración óptima
        iniciarReconocimiento();

        if (state.recordingTimer) clearInterval(state.recordingTimer);
        state.recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            document.getElementById('record-timer').textContent = `${mins}:${secs}`;
        }, 500);

        state.mediaRecorder.onstop = () => {
            const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
            state.tieneAudio = true;
            document.getElementById('btn-play-response').disabled = false;
            document.getElementById('vu-meter').classList.remove('active');
            document.getElementById('record-timer').textContent = '';
            if (state.recordingTimer) {
                clearInterval(state.recordingTimer);
                state.recordingTimer = null;
            }
            // 3. IMPORTANTE: Abortar reconocimiento para consolidar el texto exacto
            if (state.recognition && state.isRecognizing) {
                state.recognition.abort();
                state.isRecognizing = false;
            }
        };
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            mostrarStatus('❌ Permiso de micrófono denegado. Habilítelo en la configuración del navegador.', 'error');
        } else {
            console.error('Error al iniciar grabación:', e);
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

    // CONSOLIDAR TEXTO FINAL DESPUÉS DE DETENER
    setTimeout(() => {
        const tb = document.getElementById('transcription-box');
        if (tb && state.transcripcionFinal) {
            // Limpiar texto repetido e incompleto
            let textoFinal = state.transcripcionFinal.trim();
            // Borrar duplicados consecutivos si existen
            textoFinal = textoFinal.replace(/(\b\w+\b)(?:\s+\1)+/g, '$1');
            tb.value = textoFinal;
            state.textoManual = textoFinal;
            state.transcripcionFinal = textoFinal;
        }
        
        // 💡 AGREGAR ESTA LÍNEA: Inmediatamente habilitar el botón "Confirmar"
        document.getElementById('btn-confirmar').disabled = false;
    }, 100);
}

function iniciarReconocimiento() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        mostrarStatus('❌ Este navegador no soporta reconocimiento de voz.', 'error');
        return;
    }

    if (state.recognition && state.isRecognizing) {
        console.log('Reconocimiento ya activo');
        return;
    }

    const lang = 'es-VE';

    state.recognition = new SpeechRecognition();
    state.recognition.lang = lang;
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.maxAlternatives = 1;

    state.recognition.onstart = () => {
        state.isRecognizing = true;
        console.log('🎤 Reconocimiento iniciado con idioma:', lang);
    };

    state.recognition.onresult = (event) => {
        // SOLO acumular texto final (no interim)
        let finalText = '';
        for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalText += event.results[i][0].transcript + ' ';
            }
        }
        if (finalText.trim()) {
            state.transcripcionFinal += finalText;
        }

        // Solo mostrar interim en el cuadro de forma TEMPORAL
        const tb = document.getElementById('transcription-box');
        if (!tb) return;
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
            if (!event.results[i].isFinal) {
                interim += event.results[i][0].transcript;
            }
        }
        tb.value = (state.transcripcionFinal || '') + (interim ? ' ' + interim : '');
        tb.scrollTop = tb.scrollHeight;
    };

    state.recognition.onerror = (event) => {
        console.error('❌ SpeechRecognition error:', event.error);
        
        if (event.error === 'no-speech') {
            console.log('🔇 No se detectó voz, continúa escuchando...');
            return;
        }
        
        if (event.error === 'aborted') {
            console.log('Reconocimiento detenido por el usuario');
            return;
        }
        
        const mensajes = {
            'not-allowed': '❌ Permiso de micrófono denegado.',
            'audio-capture': '❌ No se detectó un micrófono.',
            'network': '❌ Error de red en el servicio de voz.',
            'language-not-supported': '❌ Idioma no soportado.'
        };
        mostrarStatus(mensajes[event.error] || `Error: ${event.error}`, 'error');
    };

    state.recognition.onend = () => {
        state.isRecognizing = false;
        console.log('🔇 Reconocimiento finalizado');
        const tb = document.getElementById('transcription-box');
        if (tb && state.transcripcionFinal) {
            tb.value = state.transcripcionFinal.trim();
            state.textoManual = tb.value;
        }
    };

    try {
        state.recognition.start();
    } catch (e) {
        console.warn('Error al iniciar reconocimiento:', e);
        mostrarStatus('Error al iniciar el reconocimiento de voz.', 'error');
    }
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

function borrarRespuesta() {
    const tb = document.getElementById('transcription-box');
    tb.value = '';
    state.transcripcionFinal = '';
    state.tieneAudio = false;
    state.audioChunks = [];
    document.getElementById('btn-play-response').disabled = true;
    document.getElementById('btn-confirmar').disabled = true;
    mostrarStatus('Respuesta borrada.', 'info');
}

// -------------------------------------------------------------------
// LÓGICA DE GUARDADO LOCAL + ENVÍO INDIVIDUAL POR PREGUNTA
// -------------------------------------------------------------------

// Guarda la respuesta en la memoria local
function guardarRespuestaLocal(itemIdx, subIdx, transcripcion) {
    respuestasLocales.push({
        itemIdx: itemIdx,
        subIdx: subIdx,
        transcripcion: transcripcion
    });
    
    localStorage.setItem('entrevista_' + state.sessionId, JSON.stringify(respuestasLocales));
    const key = `${itemIdx}_${subIdx}`;
    state.answers[key] = transcripcion;
    
    console.log(`✅ Respuesta ${itemIdx}_${subIdx} guardada localmente. Total local: ${respuestasLocales.length}`);
    return true;
}

// Función que se ejecuta al presionar "Confirmar"
async function confirmarEnvio() {
    if (state.isRecording) {
        mostrarStatus('Por favor detenga la grabación antes de confirmar.', 'error');
        return;
    }
    
    const tb = document.getElementById('transcription-box');
    let respuesta = tb.value.trim();
    
    if (!respuesta && state.transcripcionFinal) {
        respuesta = state.transcripcionFinal.trim();
        tb.value = respuesta;
    }
    
    if (!respuesta && state.tieneAudio) {
    mostrarStatus('❌ No se pudo transcribir. Por favor, grabe nuevamente o escribir su respuesta.', 'error');
    return;
}
    
    if (!respuesta && !state.tieneAudio) {
        mostrarStatus('❌ No se pudo transcribir. Por favor, grabe nuevamente o escriba su respuesta.', 'error');
        return;
    }

    const guardado = guardarRespuestaLocal(state.currentItemIdx, state.currentSubIdx, respuesta);
    if (!guardado) {
        mostrarStatus('Error al guardar la respuesta localmente.', 'error');
        return;
    }
    
    state.audioChunks = [];
    mostrarStatus('✅ Respuesta guardada localmente.', 'success');
    
    // --- ENVÍO INDIVIDUAL POR PREGUNTA ---
    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    
    // Enviar solo esta respuesta
    fetch(`${API_BASE}/entrevista-completa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: state.sessionId,
            respuestas: [{ itemIdx, subIdx, transcripcion: respuesta }]
        })
    }).then(response => {
        if (response.ok) {
            console.log(`✅ Respuesta ${itemIdx}_${subIdx} enviada a Sheets en 2º plano.`);
            actualizarEstrellasSincronizadas([`${itemIdx}_${subIdx}`]);
        } else {
            console.warn(`⚠️ La respuesta ${itemIdx}_${subIdx} não se envió. Se reintentará al final.`);
        }
    }).catch(err => {
        console.warn(`⚠️ Error de red al enviar respuesta ${itemIdx}_${subIdx}. Se reintentará ao final.`, err);
        lastSyncError = true;
        actualizarEstrellas();
    });
    // ------------------------------------------------------------------

    // Navegar a la siguiente pregunta
    if (subIdx < 2) {
        state.currentSubIdx++;
    } else if (itemIdx < state.items.length - 1) {
        state.currentItemIdx++;
        state.currentSubIdx = 0;
    } else {
        // Entrevista completada
        mostrarStatus('⏳ Sincronizando última respuesta...', 'info');
        document.getElementById('btn-confirmar').disabled = true;
        document.getElementById('btn-siguiente').disabled = true;
        
        setTimeout(() => {
            enviarRespaldoFinal();
            mostrarStatus('🎉 Entrevista completada. Datos sincronizados.', 'success');
        }, 500);
        return;
    }
    cargarPregunta();
}

// Envío de respaldo final (por si alguna pregunta individual falló)
async function enviarRespaldoFinal() {
    try {
        const respuestasPendientes = respuestasLocales.filter(r => !r._sincronizado);
        if (respuestasPendientes.length > 0) {
            console.log('🔄 Enviando respaldo final de respuestas pendientes...');
            await fetch(`${API_BASE}/entrevista-completa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: state.sessionId,
                    respuestas: respuestasLocales
                })
            });
        }
    } catch (e) {
        console.warn('El respaldo final falló, pero los datos están seguros en LocalStorage.');
    }
}

// Navegación entre preguntas
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

// Funciones de estado
function mostrarStatus(msg, type) {
    const el = document.getElementById('status-msg');
    if (!msg) { 
        el.classList.add('hidden'); 
        el.textContent = '';
        return; 
    }
    el.textContent = msg;
    el.className = 'status-msg ' + (type || '');
    el.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('view-portada').classList.remove('hidden');
    setupRecordButton();
});