/**
 * Status Bar Extension
 * @name Chameleon Ultra Status Bar
 * @version 1.1.0
 * @author Toolbox Team
 * @description Displays real-time Chameleon Ultra device status (connection, battery, slot info)
 * @source https://github.com/GameTec-live/ChameleonUltra
 */

// Create status bar element
const statusBar = document.createElement('div');
statusBar.id = 'extension-status-bar';
statusBar.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: monospace;
    font-size: 14px;
    z-index: 9999;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
`;

// Create status sections
const leftSection = document.createElement('div');
leftSection.id = 'status-left';
leftSection.innerHTML = '<strong>🌐 Web Toolbox</strong>';

const centerSection = document.createElement('div');
centerSection.id = 'status-center';
centerSection.style.cssText = 'display: flex; gap: 20px;';

const rightSection = document.createElement('div');
rightSection.id = 'status-right';
rightSection.style.cssText = 'display: flex; gap: 15px;';

statusBar.appendChild(leftSection);
statusBar.appendChild(centerSection);
statusBar.appendChild(rightSection);

// Insert at top of body
document.body.insertBefore(statusBar, document.body.firstChild);

// Adjust main content to account for status bar
document.body.style.paddingTop = '45px';

// Cached status data
let cachedBattery = null;
let cachedSlot = null;
let cachedHfTagName = null;
let cachedLfTagName = null;

// Helper to get HF tag type name (Chameleon Ultra specific)
function getHfTagTypeName(type) {
    const tagTypes = {
        0: 'Empty',
        // MIFARE Classic series (1000 range)
        1000: 'Mifare Mini',
        1001: 'Mifare 1K',
        1002: 'Mifare 2K',
        1003: 'Mifare 4K',
        // MFUL/NTAG series (1100 range)
        1100: 'NTAG 213',
        1101: 'NTAG 215',
        1102: 'NTAG 216',
        1103: 'MF0ICU1',
        1104: 'MF0ICU2',
        1105: 'MF0UL11',
        1106: 'MF0UL21',
        1107: 'NTAG 210',
        1108: 'NTAG 212',
    };
    return tagTypes[type] || `Unknown (${type})`;
}

// Helper to get LF tag type name
function getLfTagTypeName(type) {
    const tagTypes = {
        0: 'Empty',
        // ASK Tag-Talk-First (100 series)
        100: 'EM410X',
        101: 'EM410X (16-bit)',
        102: 'EM410X (32-bit)',
        103: 'EM410X (64-bit)',
        170: 'Viking',
        // FSK Tag-Talk-First (200 series)
        200: 'HID Prox',
    };
    return tagTypes[type] || `Unknown (${type})`;
}

// Update status function - with optional battery update
async function updateStatus(includeBattery = true) {
    try {
        const centerHTML = [];
        const rightHTML = [];

        // Get connected device (Chameleon Ultra only for now)
        const device = API.chameleonUltra;

        // Connection status
        if (device) {
        // Update left section with device name
        document.getElementById('status-left').innerHTML = '<strong>🦎 Chameleon Ultra</strong>';
        centerHTML.push('<span style="color: #4ade80;">● Connected</span>');

        try {
            // Get battery (only if requested) - Chameleon Ultra specific
            if (includeBattery && API.ChameleonUltra) {
                const battery = await device.cmd(API.ChameleonUltra.CMD_GET_BATTERY_INFO);
                if (battery.status === 0x68) {
                    const voltage = (battery.data[0] | (battery.data[1] << 8)) / 1000;
                    const percent = battery.data[2];
                    cachedBattery = { voltage, percent };
                }
            }

            // Display battery (cached or fresh)
            if (cachedBattery) {
                let batteryColor = '#4ade80'; // green
                if (cachedBattery.percent < 20) batteryColor = '#ef4444'; // red
                else if (cachedBattery.percent < 50) batteryColor = '#facc15'; // yellow

                rightHTML.push(`<span>🔋 <span style="color: ${batteryColor}">${cachedBattery.percent}%</span> (${cachedBattery.voltage.toFixed(2)}V)</span>`);
            }

            // Get current slot (always check) - Chameleon Ultra specific
            if (API.ChameleonUltra) {
                const slot = await device.cmd(API.ChameleonUltra.CMD_GET_ACTIVE_SLOT);
                if (slot.status === 0x68) {
                    const slotNum = slot.data[0] + 1;

                    // Always fetch slot info to debug
                    const slotInfo = await device.cmd(API.ChameleonUltra.CMD_GET_SLOT_INFO);
                    if (slotInfo.status === 0x68) {
                        const slotIndex = (slotNum - 1) * 4;

                        // Each slot has 4 bytes: [HF byte0, HF byte1, LF byte0, LF byte1]
                        const hfTypeBE = (slotInfo.data[slotIndex] << 8) | slotInfo.data[slotIndex + 1];
                        const lfTypeBE = (slotInfo.data[slotIndex + 2] << 8) | slotInfo.data[slotIndex + 3];

                        // Use big-endian (matching other code)
                        cachedHfTagName = getHfTagTypeName(hfTypeBE);
                        cachedLfTagName = getLfTagTypeName(lfTypeBE);
                        cachedSlot = slotNum;
                    }

                    rightHTML.push(`<span>📍 Slot ${cachedSlot}: HF: ${cachedHfTagName} | LF: ${cachedLfTagName}</span>`);
                }
            }
            } catch (err) {
                console.error('Status bar device error:', err);
                centerHTML.push('<span style="color: #facc15;">⚠ Error reading device</span>');
            }
        } else {
            document.getElementById('status-left').innerHTML = '<strong>🌐 Web Toolbox</strong>';
            centerHTML.push('<span style="color: #ef4444;">○ Not Connected</span>');
            rightHTML.push('<span style="opacity: 0.5;">Use: chameleonultra connect</span>');
            cachedBattery = null;
            cachedSlot = null;
            cachedHfTagName = null;
            cachedLfTagName = null;
        }

        document.getElementById('status-center').innerHTML = centerHTML.join('');
        document.getElementById('status-right').innerHTML = rightHTML.join('');
    } catch (err) {
        console.error('Status bar update error:', err);
    }
}

// Initial update
updateStatus();

// Poll for slot changes every 5 seconds (1 command)
// Poll for battery every 60 seconds (1 additional command)
let pollCount = 0;
let refreshInterval = setInterval(() => {
    if (API.chameleonUltra) {
        pollCount++;
        const includeBattery = (pollCount % 12 === 0); // Every 60s (12 * 5s)
        updateStatus(includeBattery);
    }
}, 5000);

// Listen to device events
API.on('onDeviceConnected', (device) => {
    updateStatus();
});

API.on('onDeviceDisconnected', () => {
    updateStatus();
});

API.on('onSlotChanged', (slotNum) => {
    updateStatus();
});

// Command to manually refresh status
API.registerCommand('status', 'Refresh status bar', async (args) => {
    await updateStatus();
    API.logToConsole('✓ Status bar refreshed');
});

// Command to toggle status bar
API.registerCommand('togglestatus', 'Show/hide status bar', async (args) => {
    if (statusBar.style.display === 'none') {
        statusBar.style.display = 'flex';
        document.body.style.paddingTop = '45px';
        API.logToConsole('✓ Status bar shown');
    } else {
        statusBar.style.display = 'none';
        document.body.style.paddingTop = '0px';
        API.logToConsole('✓ Status bar hidden');
    }
});

// Command to change status bar color
API.registerCommand('statuscolor', 'Change status bar color (red/blue/green/purple)', async (args) => {
    const colors = {
        red: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        blue: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        green: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        purple: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        dark: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)'
    };

    const color = args[0] || 'purple';
    if (colors[color]) {
        statusBar.style.background = colors[color];
        API.logToConsole(`✓ Status bar color changed to ${color}`);
    } else {
        API.logToConsole('Available colors: red, blue, green, purple, dark', true);
    }
});

API.logToConsole('✓ Status Bar Extension loaded');
API.logToConsole('  Commands: status, togglestatus, statuscolor <color>');
