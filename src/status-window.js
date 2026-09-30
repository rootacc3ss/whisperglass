const pill = document.getElementById('pill');
const icon = document.getElementById('icon');
const label = document.getElementById('label');
const timer = document.getElementById('timer');

let interval = 0;

function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render(state) {
    if (!state || !state.mode) return;
    const { mode, startedAt } = state;
    icon.className = 'icon';
    timer.hidden = true;
    if (interval) {
        clearInterval(interval);
        interval = 0;
    }
    if (mode === 'recording') {
        icon.classList.add('rec');
        label.textContent = 'Recording';
        timer.hidden = false;
        const tick = () => {
            timer.textContent = fmt(Date.now() - (startedAt || Date.now()));
        };
        tick();
        interval = setInterval(tick, 500);
    } else if (mode === 'transcribing') {
        icon.classList.add('busy');
        label.textContent = state.model ? `Transcribing · ${state.model}` : 'Transcribing…';
    } else if (mode === 'done') {
        icon.classList.add('ok');
        label.textContent = state.text || (state.copied ? 'Copied to clipboard' : 'Transcription ready');
        if (state.copied) label.textContent = 'Copied to clipboard';
    } else if (mode === 'error') {
        icon.classList.add('err');
        label.textContent = state.text || 'Transcription failed';
    } else {
        icon.classList.add('busy');
        label.textContent = '…';
    }
}

window.wg.on('wg:statuswin:state', (state) => render(state));
document.body.addEventListener('click', () => {
    try {
        window.wg.send('wg:statuswin:click');
    } catch {}
});
