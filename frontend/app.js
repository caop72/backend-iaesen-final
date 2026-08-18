// app.js - Versión corregida
// Botón de un solo toque, transcripción en tiempo real y texto editable

const API_BASE = 'https://backend-iaesen-final.onrender.com/api';

let recognitionRestartTimer = null;
let recognitionStarting = false;
let recognitionStopRequested = false;
let interimTranscripcion = '';
let finalTranscripcion = '';

let state = {
    role: null,
    sessionId: null,
    lang: 'es-VE',
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
    stream: null,
    isPlayingResponse: false
};


document.addEventListener('DOMContentLoaded', () => {
    const langSelector = document.getElementById('lang-selector');

    if (langSelector) {
        langSelector.addEventListener('change', (e) => {
            state.lang = e.target.value;
        });
    }

    const perfilExperto = document.getElementById('perfil-experto');

    if (perfilExperto) {
        perfilExperto.addEventListener('change', (e) => {
            const datosExperto = document.getElementById('experto-datos');

            if (!datosExperto) return;

            if (e.target.value) {
                datosExperto.classList.remove('hidden');
            } else {
                datosExperto.classList.add('hidden');
            }
        });
    }

    const portada = document.getElementById('view-portada');

    if (portada) {
        portada.classList.remove('hidden');
    }
});


function mostrarMenu() {
    document.getElementById('view-portada').classList.add('hidden');
    document.getElementById('view-home').classList.remove('hidden');
}


function showView(viewId) {
    document
        .querySelectorAll('.app-container > div[id^="view-"]')
        .forEach(el => el.classList.add('hidden'));

    const vista = document.getElementById(viewId);

    if (vista) {
        vista.classList.remove('hidden');
    }
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
    } else if (role === 'investigador') {
        showView('view-investigador');
    }
}


async function cargarPerfiles() {
    try {
        const res = await fetch(`${API_BASE}/perfiles`);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const sel = document.getElementById('perfil-experto');

        if (!sel) return;

        sel.querySelectorAll('option:not(:first-child)').forEach(option => {
            option.remove();
        });

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


async function iniciarEntrevistaExperto() {
    const perfil = document.getElementById('perfil-experto').value;
    const nombre = document.getElementById('nombre').value;
    const email = document.getElementById('email').value;
    const cargo = document.getElementById('cargo').value;
    const institucion = document.getElementById('institucion').value;
    const grado = document.getElementById('grado').value;

    if (!perfil || !nombre || !email || !cargo) {
        mostrarStatus(
            'Por favor complete todos los campos requeridos.',
            'error'
        );
        return;
    }

    state.perfil = perfil;
    state.lang = document.getElementById('lang-selector').value;

    try {
        const formData = new FormData();

        formData.append('role', 'experto');
        formData.append('perfil', perfil);
        formData.append('nombre', nombre);
        formData.append('email', email);
        formData.append('cargo', cargo);
        formData.append('institucion', institucion);
        formData.append('grado', grado);
        formData.append('lang', state.lang);

        const res = await fetch(`${API_BASE}/sesion`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error(`Error ${res.status}`);
        }

        const data = await res.json();

        state.sessionId = data.sessionId;
        state.items = data.items;
        state.currentItemIdx = 0;
        state.currentSubIdx = 0;

        showView('view-entrevista');
        await cargarPregunta();
    } catch (e) {
        console.error('Error al iniciar entrevista de experto:', e);
        mostrarStatus('Error al iniciar la entrevista.', 'error');
    }
}


async function iniciarEntrevistaNoExperto() {
    state.lang = document.getElementById('lang-selector').value;

    try {
        const formData = new FormData();

        formData.append('role', 'no_experto');
        formData.append('lang', state.lang);

        const res = await fetch(`${API_BASE}/sesion`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error(`Error ${res.status}`);
        }

        const data = await res.json();

        state.sessionId = data.sessionId;
        state.items = data.items;
        state.currentItemIdx = 0;
        state.currentSubIdx = 0;

        showView('view-entrevista');
        await cargarPregunta();
    } catch (e) {
        console.error('Error al iniciar entrevista de no experto:', e);
        mostrarStatus('Error al iniciar la entrevista.', 'error');
    }
}


async function cargarPregunta() {
    if (state.isRecording) {
        stopRecording();
    }

    clearTimeout(recognitionRestartTimer);

    const player = document.getElementById('context-audio');

    if (player) {
        player.pause();
        player.currentTime = 0;
        player.removeAttribute('src');
        player.load();
    }

    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;
    const itemNum = state.items[itemIdx];
    const globalIdx = (itemIdx * 3) + subIdx + 1;

    state.textoManual = '';
    state.transcripcion = '';
    state.tieneAudio = false;
    state.isRecognizing = false;
    state.isRecording = false;
    state.recognition = null;
    state.audioChunks = [];

    finalTranscripcion = '';
    interimTranscripcion = '';
    recognitionStarting = false;
    recognitionStopRequested = false;

    const btnRecord = document.getElementById('btn-record');
    const btnPlayResponse = document.getElementById('btn-play-response');
    const btnConfirmar = document.getElementById('btn-confirmar');
    const btnAnterior = document.getElementById('btn-anterior');
    const btnSiguiente = document.getElementById('btn-siguiente');
    const transcriptionBox = document.getElementById('transcription-box');

    if (btnRecord) btnRecord.disabled = true;
    if (btnPlayResponse) btnPlayResponse.disabled = true;
    if (btnConfirmar) btnConfirmar.disabled = true;
    if (btnAnterior) {
        btnAnterior.disabled = itemIdx === 0 && subIdx === 0;
    }
    if (btnSiguiente) btnSiguiente.disabled = false;

    if (transcriptionBox) {
        transcriptionBox.value = '';
        transcriptionBox.placeholder =
            'Verifique y corrija su respuesta acá si es necesario...';
    }

    if (state.role === 'experto' && subIdx === 0) {
        try {
            const res = await fetch(
                `${API_BASE}/item/${itemNum}?lang=${state.lang}`
            );

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();

            document.getElementById('instruction-text').innerHTML = `
                <strong>Ítem ${itemNum}:</strong> ${data.titulo}.<br>
                Escuche el contexto y luego responda las preguntas.
            `;
        } catch (e) {
            console.error('Error cargando ítem:', e);

            document.getElementById('instruction-text').textContent =
                `Ítem ${itemNum}: Cargando...`;
        }

        const itemAudio = `${API_BASE}/audio/item/${itemNum}`;
        const audio = document.getElementById('context-audio');

        audio.src = itemAudio;
        audio.load();

        audio.onended = () => {
            cargarPreguntaReal(itemNum, subIdx, globalIdx);
        };

        audio.onerror = () => {
            habilitarControlesRespuesta();

            mostrarStatus(
                'No se pudo cargar el audio del ítem. Puede responder por texto.',
                'info'
            );
        };

        return;
    }

    await cargarPreguntaReal(itemNum, subIdx, globalIdx);
}


async function cargarPreguntaReal(itemNum, subIdx, globalIdx) {
    const audio = document.getElementById('context-audio');

    audio.src = `${API_BASE}/audio/pregunta/${globalIdx}`;
    audio.load();

    try {
        const res = await fetch(
            `${API_BASE}/pregunta/${globalIdx}?lang=${state.lang}`
        );

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        document.getElementById('instruction-text').innerHTML = data.texto;
    } catch (e) {
        console.error('Error cargando pregunta:', e);

        document.getElementById('instruction-text').textContent =
            'Error al cargar la pregunta.';
    }

    audio.onended = () => {
        state.isPlaying = false;
        habilitarControlesRespuesta();

        mostrarStatus(
            'Pregunta terminada. Puede grabar o escribir su respuesta.',
            'info'
        );
    };

    audio.onerror = () => {
        habilitarControlesRespuesta();

        mostrarStatus(
            'No se pudo cargar el audio de la pregunta. Puede responder por texto.',
            'info'
        );
    };

    actualizarHexagono();
    mostrarStatus('', '');
}


function habilitarControlesRespuesta() {
    const btnRecord = document.getElementById('btn-record');
    const btnPlayResponse = document.getElementById('btn-play-response');
    const btnConfirmar = document.getElementById('btn-confirmar');

    if (btnRecord) btnRecord.disabled = false;
    if (btnPlayResponse) btnPlayResponse.disabled = false;
    if (btnConfirmar) btnConfirmar.disabled = false;
}


function actualizarHexagono() {
    const hexLabel = document.getElementById('hex-label-text');
    const itemNum = state.currentItemIdx + 1;
    const subNum = state.currentSubIdx + 1;
    const sufijos = ['RA', 'DA', 'RA'];

    if (hexLabel) {
        hexLabel.textContent =
            `${subNum}${sufijos[subNum - 1]} PREGUNTA`;
    }

    for (let i = 1; i <= 6; i++) {
        const side = document.getElementById(`side-${i}`);

        if (side) {
            side.classList.toggle('active', i === itemNum);
        }
    }
}


async function toggleRecording() {
    if (state.isRecording) {
        stopRecording();
        return;
    }

    await startRecording();
}


async function startRecording() {
    try {
        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {
            mostrarStatus(
                'Este navegador no permite acceder al micrófono.',
                'error'
            );
            return;
        }

        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        state.stream = await navigator.mediaDevices.getUserMedia(
            constraints
        );

        const mimeType = seleccionarMimeType();

        state.mediaRecorder = mimeType
            ? new MediaRecorder(state.stream, { mimeType })
            : new MediaRecorder(state.stream);

        state.audioChunks = [];

        finalTranscripcion = '';
        interimTranscripcion = '';
        state.transcripcion = '';
        state.textoManual = '';

        const transcriptionBox =
            document.getElementById('transcription-box');

        if (transcriptionBox) {
            transcriptionBox.value = '';
        }

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                state.audioChunks.push(e.data);
            }
        };

        state.mediaRecorder.onstop = () => {
            const blob = new Blob(state.audioChunks, {
                type: state.mediaRecorder.mimeType || 'audio/webm'
            });

            if (blob.size > 0) {
                state.tieneAudio = true;

                const btnPlayResponse =
                    document.getElementById('btn-play-response');

                if (btnPlayResponse) {
                    btnPlayResponse.disabled = false;
                }
            }
        };

        state.mediaRecorder.start();

        state.isRecording = true;
        recognitionStopRequested = false;

        const btnRecord = document.getElementById('btn-record');
        const recordText = document.getElementById('record-text');

        if (btnRecord) {
            btnRecord.classList.add('recording');
        }

        if (recordText) {
            recordText.innerText = 'grabando...';
        }

        iniciarReconocimiento();

        mostrarStatus('Grabando. Hable ahora...', 'success');
    } catch (e) {
        console.error('Error al iniciar la grabación:', e);

        if (
            e.name === 'NotAllowedError' ||
            e.name === 'PermissionDeniedError'
        ) {
            mostrarStatus('Permiso de micrófono denegado.', 'error');
        } else if (e.name === 'NotFoundError') {
            mostrarStatus('No se encontró ningún micrófono.', 'error');
        } else if (e.name === 'NotReadableError') {
            mostrarStatus(
                'El micrófono está siendo utilizado por otra aplicación.',
                'error'
            );
        } else {
            mostrarStatus('Error al iniciar la grabación.', 'error');
        }

        if (state.stream) {
            state.stream.getTracks().forEach(track => track.stop());
            state.stream = null;
        }
    }
}


function stopRecording() {
    state.isRecording = false;
    recognitionStopRequested = true;

    clearTimeout(recognitionRestartTimer);

    if (state.recognition) {
        try {
            state.recognition.stop();
        } catch (e) {
            console.warn('El reconocimiento ya estaba detenido:', e);
        }
    }

    state.isRecognizing = false;
    recognitionStarting = false;

    if (
        state.mediaRecorder &&
        state.mediaRecorder.state !== 'inactive'
    ) {
        state.mediaRecorder.stop();
    }

    const btnRecord = document.getElementById('btn-record');
    const recordText = document.getElementById('record-text');

    if (btnRecord) {
        btnRecord.classList.remove('recording');
    }

    if (recordText) {
        recordText.innerText = 'grabar su opinión';
    }

    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }

    actualizarTranscripcionVisible();

    mostrarStatus(
        'Grabación finalizada. Puede corregir el texto antes de enviarlo.',
        'success'
    );
}


function iniciarReconocimiento(esReinicio = false) {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        mostrarStatus(
            'Este navegador no admite transcripción automática. Puede escribir la respuesta manualmente.',
            'error'
        );
        return false;
    }

    if (!state.isRecording || recognitionStopRequested) {
        return false;
    }

    if (state.isRecognizing || recognitionStarting) {
        return true;
    }

    if (!state.recognition) {
        state.recognition = new SpeechRecognition();

        state.recognition.continuous = true;
        state.recognition.interimResults = true;
        state.recognition.maxAlternatives = 1;

        state.recognition.onstart = () => {
            recognitionStarting = false;
            state.isRecognizing = true;

            mostrarStatus(
                'Escuchando. Hable ahora...',
                'success'
            );

            console.log(
                'Reconocimiento iniciado. Idioma:',
                state.recognition.lang
            );
        };

        state.recognition.onaudiostart = () => {
            console.log('Audio detectado por SpeechRecognition');
        };

        state.recognition.onspeechstart = () => {
            console.log('Voz detectada');
        };

        state.recognition.onresult = (event) => {
            let nuevosFinales = '';
            let nuevosInterinos = '';

            for (
                let i = event.resultIndex;
                i < event.results.length;
                i++
            ) {
                const resultado = event.results[i];
                const texto = resultado[0]?.transcript || '';

                if (resultado.isFinal) {
                    nuevosFinales += texto + ' ';
                } else {
                    nuevosInterinos += texto;
                }
            }

            if (nuevosFinales.trim()) {
                finalTranscripcion += nuevosFinales;
                state.transcripcion = finalTranscripcion.trim();
            }

            interimTranscripcion = nuevosInterinos.trim();

            actualizarTranscripcionVisible();

            console.log('Texto reconocido:', {
                final: finalTranscripcion,
                provisional: interimTranscripcion
            });
        };

        state.recognition.onerror = (event) => {
            recognitionStarting = false;
            state.isRecognizing = false;

            console.error(
                'SpeechRecognition error:',
                event.error,
                event.message || ''
            );

            const mensajes = {
                'not-allowed':
                    'El navegador bloqueó el acceso al reconocimiento de voz.',
                'service-not-allowed':
                    'El servicio de reconocimiento de voz no está permitido.',
                'audio-capture':
                    'No se detectó un micrófono disponible.',
                'network':
                    'El servicio de transcripción no está disponible. Revise su conexión.',
                'language-not-supported':
                    'El idioma de reconocimiento no es compatible.',
                'no-speech':
                    'No se detectó voz. Puede continuar hablando.',
                'aborted':
                    'El reconocimiento fue detenido.'
            };

            if (
                event.error !== 'no-speech' &&
                event.error !== 'aborted'
            ) {
                mostrarStatus(
                    mensajes[event.error] ||
                    `Error de transcripción: ${event.error}`,
                    'error'
                );
            }
        };

        state.recognition.onend = () => {
            state.isRecognizing = false;
            recognitionStarting = false;

            console.log('Reconocimiento finalizado');

            if (
                state.isRecording &&
                !recognitionStopRequested
            ) {
                clearTimeout(recognitionRestartTimer);

                recognitionRestartTimer = setTimeout(() => {
                    iniciarReconocimiento(true);
                }, 300);
            }
        };
    }

    state.recognition.lang = obtenerIdiomaReconocimiento();

    try {
        recognitionStarting = true;
        state.recognition.start();

        if (esReinicio) {
            console.log('Reconocimiento reiniciado');
        }

        return true;
    } catch (e) {
        recognitionStarting = false;

        if (e.name !== 'InvalidStateError') {
            console.error(
                'No se pudo iniciar SpeechRecognition:',
                e
            );

            mostrarStatus(
                'No se pudo iniciar la transcripción automática.',
                'error'
            );
        }

        return false;
    }
}


function obtenerIdiomaReconocimiento() {
    const idioma = state.lang || 'es-VE';

    const idiomasPermitidos = [
        'es-VE',
        'es-419',
        'es-ES',
        'en-US',
        'pt-BR'
    ];

    return idiomasPermitidos.includes(idioma)
        ? idioma
        : 'es-VE';
}


function actualizarTranscripcionVisible() {
    const tb = document.getElementById('transcription-box');

    if (!tb) {
        console.error(
            'No existe el elemento #transcription-box en index.html'
        );
        return;
    }

    const partes = [
        finalTranscripcion.trim(),
        interimTranscripcion.trim()
    ].filter(Boolean);

    tb.value = partes
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    tb.scrollTop = tb.scrollHeight;

    state.transcripcion = finalTranscripcion.trim();

    tb.dispatchEvent(
        new Event('input', { bubbles: true })
    );
}


function seleccionarMimeType() {
    const tipos = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4'
    ];

    if (
        typeof MediaRecorder === 'undefined' ||
        !MediaRecorder.isTypeSupported
    ) {
        return '';
    }

    return tipos.find(tipo =>
        MediaRecorder.isTypeSupported(tipo)
    ) || '';
}


function playResponse() {
    if (state.isPlayingResponse) {
        mostrarStatus(
            'Ya está reproduciendo una respuesta.',
            'info'
        );
        return;
    }

    if (!state.audioChunks || state.audioChunks.length === 0) {
        mostrarStatus(
            'No hay respuesta grabada para reproducir.',
            'error'
        );
        return;
    }

    const mimeType =
        state.mediaRecorder?.mimeType || 'audio/webm';

    const blob = new Blob(state.audioChunks, {
        type: mimeType
    });

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    state.isPlayingResponse = true;

    audio.onended = () => {
        state.isPlayingResponse = false;
        URL.revokeObjectURL(url);
    };

    audio.onerror = () => {
        state.isPlayingResponse = false;
        URL.revokeObjectURL(url);

        mostrarStatus(
            'No se pudo reproducir la respuesta.',
            'error'
        );
    };

    audio.play().catch(error => {
        console.error('Error reproduciendo respuesta:', error);

        state.isPlayingResponse = false;
        URL.revokeObjectURL(url);

        mostrarStatus(
            'El navegador no pudo reproducir la respuesta.',
            'error'
        );
    });
}


async function confirmarEnvio() {
    if (state.isRecording) {
        mostrarStatus(
            'Por favor detenga la grabación antes de confirmar.',
            'error'
        );
        return;
    }

    const transcriptionBox =
        document.getElementById('transcription-box');

    const respuesta = transcriptionBox
        ? transcriptionBox.value.trim()
        : '';

    if (!respuesta && !state.tieneAudio) {
        mostrarStatus(
            'Debe escribir o grabar una respuesta antes de confirmar.',
            'error'
        );
        return;
    }

    const guardado = await guardarRespuesta(respuesta);

    if (!guardado) {
        mostrarStatus(
            'No se pudo guardar la respuesta.',
            'error'
        );
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
        mostrarStatus(
            '🎉 Entrevista completada. ¡Gracias por participar!',
            'success'
        );

        document.getElementById('btn-confirmar').disabled = true;
        document.getElementById('btn-siguiente').disabled = true;

        return;
    }

    await cargarPregunta();
    mostrarStatus('', '');
}


async function navegar(direccion) {
    if (state.isRecording) {
        mostrarStatus(
            'Por favor detenga la grabación antes de avanzar.',
            'error'
        );
        return;
    }

    const itemIdx = state.currentItemIdx;
    const subIdx = state.currentSubIdx;

    if (direccion === 1) {
        if (subIdx < 2) {
            state.currentSubIdx++;
            await cargarPregunta();
        } else if (itemIdx < state.items.length - 1) {
            state.currentItemIdx++;
            state.currentSubIdx = 0;
            await cargarPregunta();
        } else {
            mostrarStatus(
                'Ya está en la última pregunta.',
                'info'
            );
        }
    } else if (direccion === -1) {
        if (subIdx > 0) {
            state.currentSubIdx--;
            await cargarPregunta();
        } else if (itemIdx > 0) {
            state.currentItemIdx--;
            state.currentSubIdx = 2;
            await cargarPregunta();
        } else {
            mostrarStatus(
                'Ya está en la primera pregunta.',
                'info'
            );
        }
    }

    mostrarStatus('', '');
}


async function guardarRespuesta(respuesta) {
    const formData = new FormData();

    formData.append('sessionId', state.sessionId);
    formData.append('itemIdx', state.currentItemIdx);
    formData.append('subIdx', state.currentSubIdx);
    formData.append('transcripcion', respuesta);
    formData.append('perfil', state.role);
    formData.append('lang', state.lang);

    if (state.audioChunks && state.audioChunks.length > 0) {
        const mimeType =
            state.mediaRecorder?.mimeType || 'audio/webm';

        const blob = new Blob(state.audioChunks, {
            type: mimeType
        });

        formData.append(
            'audio',
            blob,
            'respuesta.webm'
        );
    }

    try {
        const res = await fetch(`${API_BASE}/respuesta`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        state.audioChunks = [];
        return true;
    } catch (e) {
        console.error(
            'Error al guardar la respuesta:',
            e
        );

        return false;
    }
}


function mostrarStatus(msg, type) {
    const el = document.getElementById('status-msg');

    if (!el) return;

    if (!msg) {
        el.classList.add('hidden');
        return;
    }

    el.textContent = msg;
    el.className = 'status-msg ' + (type || '');
    el.classList.remove('hidden');
}


async function accederDashboard() {
    const clave =
        document.getElementById('clave-investigador').value;

    if (clave !== '5656') {
        mostrarStatus('Clave incorrecta.', 'error');
        return;
    }

    document
        .getElementById('dashboard-content')
        .classList.remove('hidden');

    await cargarDashboard();
}


async function cargarDashboard() {
    try {
        const res = await fetch(
            `${API_BASE}/admin/dashboard`
        );

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        document.getElementById('dashboard-stats').innerHTML = `
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                <div style="background: #1c2541; padding: 16px; border-radius: 8px; flex: 1; min-width: 120px;">
                    <h4 style="color: #90e0ef; margin: 0;">📝 Respuestas</h4>
                    <p style="font-size: 2rem; margin: 4px 0; color: #fff;">
                        ${data.totalRespuestas}
                    </p>
                </div>

                <div style="background: #1c2541; padding: 16px; border-radius: 8px; flex: 1; min-width: 120px;">
                    <h4 style="color: #90e0ef; margin: 0;">👤 Sesiones</h4>
                    <p style="font-size: 2rem; margin: 4px 0; color: #fff;">
                        ${data.totalSesiones}
                    </p>
                </div>

                <div style="background: #1c2541; padding: 16px; border-radius: 8px; flex: 1; min-width: 120px;">
                    <h4 style="color: #90e0ef; margin: 0;">🎥 Videos pendientes</h4>
                    <p style="font-size: 2rem; margin: 4px 0; color: #fff;">
                        ${data.videosPendientes}
                    </p>
                </div>
            </div>
        `;
    } catch (e) {
        console.error('Error cargando dashboard:', e);

        document.getElementById('dashboard-stats').textContent =
            'Error cargando datos.';
    }
}


async function sincronizarVideos() {
    const btn = document.querySelector(
        'button[onclick="sincronizarVideos()"]'
    );

    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '⏳ Sincronizando...';

    try {
        const res = await fetch(
            `${API_BASE}/admin/sincronizar_videos`,
            {
                method: 'POST'
            }
        );

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const status = document.getElementById('sync-status');

        status.textContent = data.mensaje;
        status.className = 'status-msg success';
        status.classList.remove('hidden');

        await cargarDashboard();
    } catch (e) {
        console.error('Error sincronizando videos:', e);

        const status = document.getElementById('sync-status');

        status.textContent = 'Error al sincronizar.';
        status.className = 'status-msg error';
        status.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔁 Sincronizar videos pendientes';
    }
}