export function deviceRank(device) {
    const label = `${device.label || ''}`.toLowerCase();
    const id = `${device.deviceId || ''}`.toLowerCase();
    const both = `${label} ${id}`;
    if (/internal|built-?in|alc\d|ryzen|family \d/.test(both)) return 1;
    if (/webcam|c920|camera|logitech/.test(both)) return 2;
    if (/bluetooth|bluez|bose|headphone|headset|airpods|earbuds/.test(both)) return 4;
    return 3;
}

export function sortAudioInputs(devices) {
    return [...(devices || [])]
        .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
        .sort((a, b) => deviceRank(a) - deviceRank(b));
}
