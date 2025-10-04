/**
 * Chameleon Ultra Device Extension
 * @name Chameleon Ultra
 * @version 1.2.0
 * @author Toolbox Team
 * @description Device driver for Chameleon Ultra via BLE and Serial connections
 * @source https://github.com/GameTec-live/ChameleonUltra
 */

(function() {
    'use strict';

    // Chameleon Ultra specific UUIDs
    const NRF_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const UART_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
    const UART_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

    // Command constants
    const CMD_SET_ACTIVE_SLOT = 1003;
    const CMD_GET_ACTIVE_SLOT = 1018;
    const CMD_GET_SLOT_INFO = 1019;
    const CMD_GET_ALL_SLOT_NICKS = 1038;
    const CMD_GET_ENABLED_SLOTS = 1023;
    const CMD_SET_SLOT_TAG_TYPE = 1004;
    const CMD_SET_SLOT_DATA_DEFAULT = 1005;
    const CMD_SET_SLOT_ENABLE = 1006;
    const CMD_DELETE_SLOT_INFO = 1024;
    const CMD_GET_BATTERY_INFO = 1025;
    const CMD_MF1_SET_ANTICOLLISION = 4001;
    const CMD_MF0_NTAG_WRITE_EMU_PAGE_DATA = 4022;
    const CMD_MF0_NTAG_READ_EMU_PAGE_DATA = 4021;
    const CMD_MF0_NTAG_GET_VERSION_DATA = 4023;
    const CMD_MF0_NTAG_SET_VERSION_DATA = 4024;
    const CMD_MF0_NTAG_GET_SIGNATURE_DATA = 4025;
    const CMD_MF0_NTAG_SET_SIGNATURE_DATA = 4026;
    const CMD_MF0_NTAG_SET_WRITE_MODE = 4032;
    const CMD_MF0_NTAG_SET_UID_MAGIC_MODE = 4020;
    const CMD_SLOT_DATA_CONFIG_SAVE = 1009;
    const CMD_SET_SLOT_TAG_NICK = 1007;
    const CMD_GET_SLOT_TAG_NICK = 1008;
    const CMD_SET_ACTIVE_MODE = 1001;
    const CMD_HF14A_SCAN = 2000;
    const CMD_HF14A_RAW = 2010;
    const CMD_MF1_WRITE_EMU_BLOCK_DATA = 4000;
    const CMD_MF1_READ_EMU_BLOCK_DATA = 4008;
    const CMD_EM410X_SET_EMU_ID = 5000;
    const CMD_EM410X_GET_EMU_ID = 5001;

    // Chameleon Ultra BLE Device (uses same SOF/LRC protocol as Serial)
    class ChameleonUltraBLE extends Device {
        constructor() {
            super('Chameleon Ultra', ['nfc', 'rfid', 'emulator', 'reader']);
            this.responseCallbacks = {};
            this.buffer = new Uint8Array(0);
            this.SOF = 0x11;
        }

        async connect(transportType = 'ble', options = {}) {
            // If transport is already provided (from registry), use it
            if (options.transport) {
                this.transport = options.transport;
            } else {
                // Create new transport
                this.transport = new BLETransport();
                await this.transport.connect({
                    serviceUUID: NRF_SERVICE_UUID,
                    txCharacteristicUUID: UART_RX_UUID,
                    rxCharacteristicUUID: UART_TX_UUID,
                    filters: [
                        { namePrefix: 'Ultra' },
                        { namePrefix: 'Chameleon' }
                    ]
                });
            }

            // Set up frame parser (same as Serial)
            this.transport.onData((data) => {
                console.log('📥 BLE RX:', data.length, 'bytes:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
                const newBuffer = new Uint8Array(this.buffer.length + data.length);
                newBuffer.set(this.buffer);
                newBuffer.set(data, this.buffer.length);
                this.buffer = newBuffer;
                console.log('BLE Buffer total:', this.buffer.length, 'bytes');
                this.parseFrames(this.buffer);
            });
        }

        lrcCalc(data) {
            let ret = 0x00;
            for (let b of data) {
                ret += b;
                ret &= 0xFF;
            }
            return (0x100 - ret) & 0xFF;
        }

        makeDataFrame(cmd, data = null, status = 0) {
            if (data === null) data = new Uint8Array(0);
            const dataLen = data.length;

            // Frame format: SOF(1)|LRC1(1)|CMD(2)|STATUS(2)|LENGTH(2)|LRC2(1)|DATA(n)|LRC3(1)
            const frameLen = 1 + 1 + 2 + 2 + 2 + 1 + dataLen + 1;
            const frame = new Uint8Array(frameLen);
            let offset = 0;

            // SOF
            frame[offset++] = this.SOF;

            // LRC1 (placeholder)
            const lrc1Pos = offset++;

            // CMD (big-endian uint16)
            frame[offset++] = (cmd >> 8) & 0xFF;
            frame[offset++] = cmd & 0xFF;

            // STATUS (big-endian uint16)
            frame[offset++] = (status >> 8) & 0xFF;
            frame[offset++] = status & 0xFF;

            // LENGTH (big-endian uint16)
            frame[offset++] = (dataLen >> 8) & 0xFF;
            frame[offset++] = dataLen & 0xFF;

            // LRC2 (placeholder)
            const lrc2Pos = offset++;

            // DATA
            if (dataLen > 0) {
                frame.set(data, offset);
                offset += dataLen;
            }

            // LRC3 (placeholder)
            const lrc3Pos = offset;

            // Calculate LRCs
            frame[lrc1Pos] = this.lrcCalc(frame.slice(0, lrc1Pos));
            frame[lrc2Pos] = this.lrcCalc(frame.slice(0, lrc2Pos));
            frame[lrc3Pos] = this.lrcCalc(frame.slice(0, lrc3Pos));

            return frame;
        }

        parseFrames(buffer) {
            while (buffer.length > 0) {
                // Need at least header: SOF(1) + LRC1(1) + CMD(2) + STATUS(2) + LENGTH(2) + LRC2(1) = 9 bytes
                if (buffer.length < 9) break;

                // Check SOF
                if (buffer[0] !== this.SOF) {
                    console.log("Invalid SOF, skipping byte");
                    buffer = buffer.slice(1);
                    this.buffer = buffer;
                    continue;
                }

                // Verify LRC1
                if (buffer[1] !== this.lrcCalc(buffer.slice(0, 1))) {
                    console.log("LRC1 mismatch");
                    buffer = buffer.slice(1);
                    this.buffer = buffer;
                    continue;
                }

                // Parse header
                const cmd = (buffer[2] << 8) | buffer[3];
                const status = (buffer[4] << 8) | buffer[5];
                const dataLen = (buffer[6] << 8) | buffer[7];

                // Check if we have complete frame
                const frameLen = 9 + dataLen + 1;
                if (buffer.length < frameLen) break;

                // Verify LRC2
                if (buffer[8] !== this.lrcCalc(buffer.slice(0, 8))) {
                    console.log("LRC2 mismatch");
                    buffer = buffer.slice(1);
                    this.buffer = buffer;
                    continue;
                }

                // Extract data
                const data = buffer.slice(9, 9 + dataLen);

                // Verify LRC3
                if (buffer[9 + dataLen] !== this.lrcCalc(buffer.slice(0, 9 + dataLen))) {
                    console.log("LRC3 mismatch");
                    buffer = buffer.slice(1);
                    this.buffer = buffer;
                    continue;
                }

                // Valid frame received
                const response = {
                    cmd: cmd,
                    status: status,
                    data: data
                };

                console.log('📥 BLE RX:', 'CMD', cmd, 'Status', status, 'Data length', dataLen);

                if (this.responseCallbacks[cmd]) {
                    this.responseCallbacks[cmd](response);
                    delete this.responseCallbacks[cmd];
                }

                // Remove processed frame from buffer
                buffer = buffer.slice(frameLen);
                this.buffer = buffer;
            }
        }

        async sendCommand(cmd, data = null, status = 0, timeout = 5000) {
            const frame = this.makeDataFrame(cmd, data, status);
            console.log('📤 BLE TX:', 'CMD', cmd, '-', frame.length, 'bytes:', Array.from(frame).map(b => b.toString(16).padStart(2, '0')).join(' '));

            return new Promise(async (resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.log('⏱️  Timeout waiting for CMD', cmd);
                    delete this.responseCallbacks[cmd];
                    reject(new Error('Command response timed out'));
                }, timeout);

                this.responseCallbacks[cmd] = (response) => {
                    console.log('✅ Got response for CMD', cmd);
                    clearTimeout(timeoutId);
                    resolve(response);
                };

                await this.transport.send(frame);
            });
        }

        // Helper method
        async cmd(cmdNum, data = null) {
            return await this.sendCommand(cmdNum, data, 0, 5000);
        }
    }

    // Chameleon Ultra Serial Device
    class ChameleonUltraSerial extends Device {
        constructor() {
            super('Chameleon Ultra', ['nfc', 'rfid', 'emulator', 'reader']);
            this.responseCallbacks = {};
            this.buffer = new Uint8Array(0);
            this.SOF = 0x11;
        }

        async connect(transportType = 'serial', options = {}) {
            // If transport is already provided (from registry), use it
            if (options.transport) {
                this.transport = options.transport;
            } else {
                // Create new transport
                this.transport = new SerialTransport();
                await this.transport.connect({ baudRate: 115200 });
            }

            // Set up frame parser
            this.transport.onData((data) => {
                console.log('📥 Serial RX:', data.length, 'bytes:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
                const buffer = this.transport.getBuffer();
                console.log('Buffer total:', buffer.length, 'bytes');
                this.parseFrames(buffer);
            });
        }

        lrcCalc(data) {
            let lrc = 0;
            for (let i = 0; i < data.length; i++) {
                lrc += data[i];
                lrc &= 0xFF;
            }
            return (0x100 - lrc) & 0xFF;
        }

        makeDataFrame(cmd, data = null, status = 0) {
            if (data === null) data = new Uint8Array(0);
            const dataLen = data.length;

            // Frame format: SOF(1)|LRC1(1)|CMD(2)|STATUS(2)|LENGTH(2)|LRC2(1)|DATA(n)|LRC3(1)
            const frameLen = 1 + 1 + 2 + 2 + 2 + 1 + dataLen + 1;
            const frame = new Uint8Array(frameLen);
            let offset = 0;

            // SOF
            frame[offset++] = this.SOF;

            // LRC1 (placeholder)
            const lrc1Pos = offset++;

            // CMD (big-endian uint16)
            frame[offset++] = (cmd >> 8) & 0xFF;
            frame[offset++] = cmd & 0xFF;

            // STATUS (big-endian uint16)
            frame[offset++] = (status >> 8) & 0xFF;
            frame[offset++] = status & 0xFF;

            // LENGTH (big-endian uint16)
            frame[offset++] = (dataLen >> 8) & 0xFF;
            frame[offset++] = dataLen & 0xFF;

            // LRC2 (placeholder)
            const lrc2Pos = offset++;

            // DATA
            if (dataLen > 0) {
                frame.set(data, offset);
                offset += dataLen;
            }

            // LRC3 (placeholder)
            const lrc3Pos = offset;

            // Calculate LRCs
            frame[lrc1Pos] = this.lrcCalc(frame.slice(0, lrc1Pos));
            frame[lrc2Pos] = this.lrcCalc(frame.slice(0, lrc2Pos));
            frame[lrc3Pos] = this.lrcCalc(frame.slice(0, lrc3Pos));

            return frame;
        }

        parseFrames(buffer) {
            while (buffer.length > 0) {
                // Need at least header: SOF(1) + LRC1(1) + CMD(2) + STATUS(2) + LENGTH(2) + LRC2(1) = 9 bytes
                if (buffer.length < 9) break;

                // Check SOF
                if (buffer[0] !== this.SOF) {
                    console.log("Invalid SOF, skipping byte");
                    buffer = buffer.slice(1);
                    const temp = new Uint8Array(buffer.length);
                    temp.set(buffer);
                    this.transport.clearBuffer();
                    this.transport.readBuffer = temp;
                    buffer = temp;
                    continue;
                }

                // Verify LRC1
                if (buffer[1] !== this.lrcCalc(buffer.slice(0, 1))) {
                    console.log("LRC1 mismatch");
                    buffer = buffer.slice(1);
                    const temp = new Uint8Array(buffer.length);
                    temp.set(buffer);
                    this.transport.clearBuffer();
                    this.transport.readBuffer = temp;
                    buffer = temp;
                    continue;
                }

                // Parse header
                const cmd = (buffer[2] << 8) | buffer[3];
                const status = (buffer[4] << 8) | buffer[5];
                const dataLen = (buffer[6] << 8) | buffer[7];

                // Check if we have complete frame
                const frameLen = 9 + dataLen + 1;
                if (buffer.length < frameLen) break;

                // Verify LRC2
                if (buffer[8] !== this.lrcCalc(buffer.slice(0, 8))) {
                    console.log("LRC2 mismatch");
                    buffer = buffer.slice(1);
                    const temp = new Uint8Array(buffer.length);
                    temp.set(buffer);
                    this.transport.clearBuffer();
                    this.transport.readBuffer = temp;
                    buffer = temp;
                    continue;
                }

                // Extract data
                const data = buffer.slice(9, 9 + dataLen);

                // Verify LRC3
                if (buffer[9 + dataLen] !== this.lrcCalc(buffer.slice(0, 9 + dataLen))) {
                    console.log("LRC3 mismatch");
                    buffer = buffer.slice(1);
                    const temp = new Uint8Array(buffer.length);
                    temp.set(buffer);
                    this.transport.clearBuffer();
                    this.transport.readBuffer = temp;
                    buffer = temp;
                    continue;
                }

                // Valid frame received
                const response = {
                    cmd: cmd,
                    status: status,
                    data: data
                };

                console.log('📥 Serial RX Frame:', 'CMD', cmd, 'Status', status, 'Data length', dataLen);

                if (this.responseCallbacks[cmd]) {
                    this.responseCallbacks[cmd](response);
                    delete this.responseCallbacks[cmd];
                }

                // Remove processed frame from buffer
                const remaining = buffer.slice(frameLen);
                this.transport.clearBuffer();
                if (remaining.length > 0) {
                    const temp = new Uint8Array(remaining.length);
                    temp.set(remaining);
                    this.transport.readBuffer = temp;
                    buffer = temp;
                } else {
                    break;
                }
            }
        }

        async sendCommand(cmd, data = null, status = 0, timeout = 10000) {
            const frame = this.makeDataFrame(cmd, data, status);
            console.log('📤 Serial TX:', 'CMD', cmd, '-', frame.length, 'bytes:', Array.from(frame).map(b => b.toString(16).padStart(2, '0')).join(' '));

            return new Promise(async (resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.log('⏱️  Serial timeout waiting for CMD', cmd);
                    delete this.responseCallbacks[cmd];
                    reject(new Error('Command response timed out'));
                }, timeout);

                this.responseCallbacks[cmd] = (response) => {
                    console.log('✅ Serial got response for CMD', cmd);
                    clearTimeout(timeoutId);
                    resolve(response);
                };

                await this.transport.send(frame);
            });
        }

        async cmd(cmdNum, data = null) {
            return await this.sendCommand(cmdNum, data, 0, 10000);
        }
    }

    // Register device with the registry
    if (window.ToolboxAPI && window.ToolboxAPI.deviceRegistry) {
        const registry = window.ToolboxAPI.deviceRegistry;

        // Register both BLE and Serial variants
        registry.register(ChameleonUltraBLE, {
            id: 'chameleon-ultra-ble',
            name: 'Chameleon Ultra (BLE)',
            description: 'Chameleon Ultra connected via Bluetooth Low Energy',
            capabilities: ['nfc', 'rfid', 'emulator', 'reader']
        });

        registry.register(ChameleonUltraSerial, {
            id: 'chameleon-ultra-serial',
            name: 'Chameleon Ultra (Serial)',
            description: 'Chameleon Ultra connected via USB Serial',
            capabilities: ['nfc', 'rfid', 'emulator', 'reader']
        });

        // Export constants namespaced under ChameleonUltra
        window.ToolboxAPI.ChameleonUltra = {
            CMD_SET_ACTIVE_SLOT,
            CMD_GET_ACTIVE_SLOT,
            CMD_GET_SLOT_INFO,
            CMD_GET_ALL_SLOT_NICKS,
            CMD_GET_ENABLED_SLOTS,
            CMD_SET_SLOT_TAG_TYPE,
            CMD_SET_SLOT_DATA_DEFAULT,
            CMD_SET_SLOT_ENABLE,
            CMD_DELETE_SLOT_INFO,
            CMD_GET_BATTERY_INFO,
            CMD_MF1_SET_ANTICOLLISION,
            CMD_MF0_NTAG_WRITE_EMU_PAGE_DATA,
            CMD_MF0_NTAG_READ_EMU_PAGE_DATA,
            CMD_MF0_NTAG_GET_VERSION_DATA,
            CMD_MF0_NTAG_SET_VERSION_DATA,
            CMD_MF0_NTAG_GET_SIGNATURE_DATA,
            CMD_MF0_NTAG_SET_SIGNATURE_DATA,
            CMD_MF0_NTAG_SET_WRITE_MODE,
            CMD_MF0_NTAG_SET_UID_MAGIC_MODE,
            CMD_SLOT_DATA_CONFIG_SAVE,
            CMD_SET_SLOT_TAG_NICK,
            CMD_GET_SLOT_TAG_NICK,
            CMD_SET_ACTIVE_MODE,
            CMD_HF14A_SCAN,
            CMD_HF14A_RAW
        };

        // Also export constants globally for script compatibility
        Object.assign(window, window.ToolboxAPI.ChameleonUltra);

        // Register device with command system
        const API = window.ToolboxAPI;
        API.registerDevice('chameleonultra', 'Chameleon Ultra');

        // Helper to get HF tag type name
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

        // Get connected device (BLE or Serial)
        function getDevice() {
            const device = API.chameleonUltra || window.chameleonUltra;
            if (!device) {
                throw new Error('Not connected. Use: chameleonultra connect');
            }
            return device;
        }

        // Register commands
        API.registerDeviceCommand('chameleonultra', 'connect', 'Connect to Chameleon Ultra via BLE', async () => {
            document.getElementById('connectBleButton').click();
        });

        API.registerDeviceCommand('chameleonultra', 'disconnect', 'Disconnect from device', async () => {
            const device = API.chameleonUltra || window.chameleonUltra;
            if (device) {
                await device.disconnect();
                API.logToConsole('✓ Disconnected');
            } else {
                API.logToConsole('Not connected', true);
            }
        });

        API.registerDeviceCommand('chameleonultra', 'battery', 'Show battery level', async () => {
            const device = getDevice();
            const battery = await device.cmd(CMD_GET_BATTERY_INFO);
            if (battery.status === 0x68) {
                const voltage = (battery.data[0] | (battery.data[1] << 8)) / 1000;
                const percent = battery.data[2];
                API.logToConsole(`Battery: ${voltage.toFixed(2)}V (${percent}%)`);
            } else {
                API.logToConsole(`Error reading battery: Status ${battery.status}`, true);
            }
        });

        API.registerDeviceCommand('chameleonultra', 'slot', 'Slot management (use: chameleonultra slot <list|info|change|details|loadram|loadflash|save>)', async (args) => {
            if (!args[0]) {
                API.logToConsole('Usage: chameleonultra slot <list|info|change|details|loadram|loadflash|save>');
                return;
            }

            const slotCmd = args[0].toLowerCase();
            const device = getDevice();

            if (slotCmd === 'list') {
                API.logToConsole('Slots: 1-8 (use "chameleonultra slot change <n>" to switch)');
            } else if (slotCmd === 'info') {
                const slot = await device.cmd(CMD_GET_ACTIVE_SLOT);
                if (slot.status === 0x68) {
                    API.logToConsole(`Current slot: ${slot.data[0] + 1}`);
                } else {
                    API.logToConsole(`Error reading slot: Status ${slot.status}`, true);
                }
            } else if (slotCmd === 'details') {
                // Get slot number (current if not specified)
                let slotNum;
                if (args[1]) {
                    slotNum = parseInt(args[1]);
                    if (slotNum < 1 || slotNum > 8) {
                        API.logToConsole('Slot must be 1-8', true);
                        return;
                    }
                } else {
                    const currentSlot = await device.cmd(CMD_GET_ACTIVE_SLOT);
                    if (currentSlot.status !== 0x68) {
                        API.logToConsole('Error reading current slot', true);
                        return;
                    }
                    slotNum = currentSlot.data[0] + 1;
                }

                // Get slot info
                const slotInfo = await device.cmd(CMD_GET_SLOT_INFO);
                if (slotInfo.status !== 0x68) {
                    API.logToConsole('Error reading slot info', true);
                    return;
                }

                // Parse slot data (big-endian: high byte first, low byte second)
                const slotIndex = (slotNum - 1) * 4;
                const hfType = (slotInfo.data[slotIndex] << 8) | slotInfo.data[slotIndex + 1];
                const lfType = (slotInfo.data[slotIndex + 2] << 8) | slotInfo.data[slotIndex + 3];

                // Get nickname
                const nickname = await device.cmd(CMD_GET_SLOT_TAG_NICK, new Uint8Array([slotNum - 1, 2]));
                let nickStr = 'Unnamed';
                if (nickname.status === 0x68 && nickname.data.length > 0) {
                    nickStr = new TextDecoder().decode(nickname.data);
                }

                API.logToConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                API.logToConsole(`Slot ${slotNum}: ${nickStr}`);
                API.logToConsole(`  HF: ${getHfTagTypeName(hfType)}`);
                API.logToConsole(`  LF: ${getLfTagTypeName(lfType)}`);
                API.logToConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            } else if (slotCmd === 'change') {
                if (!args[1]) {
                    API.logToConsole('Usage: chameleonultra slot change <1-8>');
                    return;
                }
                const slotNum = parseInt(args[1]);
                if (slotNum < 1 || slotNum > 8) {
                    API.logToConsole('Slot must be 1-8', true);
                    return;
                }
                const result = await device.cmd(CMD_SET_ACTIVE_SLOT, new Uint8Array([slotNum - 1]));
                if (result.status === 0x68) {
                    API.logToConsole(`✓ Changed to slot ${slotNum}`);
                    API._trigger('onSlotChanged', slotNum);
                } else {
                    API.logToConsole(`Error changing slot: Status ${result.status}`, true);
                }
            } else if (slotCmd === 'loadram' || slotCmd === 'loadflash') {
                // Usage: chameleonultra slot loadram [slot] <hf|lf> <tag_type> <file>
                //    or: chameleonultra slot loadflash [slot] <hf|lf> <tag_type> <file>
                const saveToFlash = (slotCmd === 'loadflash');

                if (args.length < 4) {
                    API.logToConsole(`Usage: chameleonultra slot ${slotCmd} [slot] <hf|lf> <tag_type> <file>`, true);
                    API.logToConsole('Examples:');
                    API.logToConsole(`  chameleonultra slot ${slotCmd} hf ntag215 dump.bin        (uses current slot)`);
                    API.logToConsole(`  chameleonultra slot ${slotCmd} 1 hf ntag215 dump.bin      (uses slot 1)`);
                    API.logToConsole(`  chameleonultra slot ${slotCmd} 3 lf em410x id.bin         (uses slot 3)`);
                    API.logToConsole('');
                    API.logToConsole('Note: loadram writes to RAM (temporary), loadflash writes to flash (persistent)');
                    return;
                }

                // Check if first arg is a slot number
                let slotNum = null;
                let argOffset = 1;
                const firstArg = args[1];
                const possibleSlotNum = parseInt(firstArg);
                if (!isNaN(possibleSlotNum) && possibleSlotNum >= 1 && possibleSlotNum <= 8 && firstArg === possibleSlotNum.toString()) {
                    // First arg is a valid slot number
                    slotNum = possibleSlotNum - 1; // Convert to 0-indexed
                    argOffset = 2;
                }

                const frequency = args[argOffset].toLowerCase(); // hf or lf
                const tagType = args[argOffset + 1].toLowerCase();
                const filePath = args.slice(argOffset + 2).join(' '); // Support spaces in path

                // Map tag type names to numeric values
                const tagTypeMap = {
                    // HF tags
                    'mifaremini': 1000,
                    'mifare1k': 1001,
                    'mifare2k': 1002,
                    'mifare4k': 1003,
                    'ntag213': 1100,
                    'ntag215': 1101,
                    'ntag216': 1102,
                    'ntag210': 1107,
                    'ntag212': 1108,
                    // LF tags
                    'em410x': 100,
                    'hidprox': 200,
                    'viking': 170,
                };

                const tagTypeValue = tagTypeMap[tagType];
                if (!tagTypeValue) {
                    API.logToConsole(`Unknown tag type: ${tagType}`, true);
                    API.logToConsole('Supported types: ' + Object.keys(tagTypeMap).join(', '));
                    return;
                }

                // Verify frequency matches tag type
                if (frequency === 'hf' && tagTypeValue < 1000) {
                    API.logToConsole(`Tag type ${tagType} is LF, not HF`, true);
                    return;
                }
                if (frequency === 'lf' && tagTypeValue >= 1000) {
                    API.logToConsole(`Tag type ${tagType} is HF, not LF`, true);
                    return;
                }

                try {
                    // Read file
                    const fileData = await API.readFile(filePath);
                    if (!fileData) {
                        API.logToConsole(`Failed to read file: ${filePath}`, true);
                        return;
                    }

                    API.logToConsole(`Loaded ${fileData.length} bytes from ${filePath}`);

                    // Get slot number (use specified slot or current slot)
                    if (slotNum === null) {
                        const currentSlot = await device.cmd(CMD_GET_ACTIVE_SLOT);
                        if (currentSlot.status !== 0x68) {
                            API.logToConsole('Error reading current slot', true);
                            return;
                        }
                        slotNum = currentSlot.data[0];
                    }

                    // If loading to a different slot, switch to it first
                    const currentSlotCheck = await device.cmd(CMD_GET_ACTIVE_SLOT);
                    if (currentSlotCheck.status === 0x68 && currentSlotCheck.data[0] !== slotNum) {
                        API.logToConsole(`Switching to slot ${slotNum + 1}...`);
                        const switchResult = await device.cmd(CMD_SET_ACTIVE_SLOT, new Uint8Array([slotNum]));
                        if (switchResult.status !== 0x68) {
                            API.logToConsole(`Error switching to slot ${slotNum + 1}: Status ${switchResult.status}`, true);
                            return;
                        }
                    }

                    // Step 1: Set tag type for the appropriate frequency
                    API.logToConsole(`Setting slot ${slotNum + 1} ${frequency.toUpperCase()} to ${tagType}...`);
                    const tagTypeBytes = new Uint8Array(3);
                    tagTypeBytes[0] = slotNum;
                    tagTypeBytes[1] = (tagTypeValue >> 8) & 0xFF;  // Big-endian
                    tagTypeBytes[2] = tagTypeValue & 0xFF;

                    const setTypeResult = await device.cmd(CMD_SET_SLOT_TAG_TYPE, tagTypeBytes);
                    if (setTypeResult.status !== 0x68) {
                        API.logToConsole(`Error setting tag type: Status ${setTypeResult.status}`, true);
                        return;
                    }

                    // Step 2: Write data based on tag type
                    if (frequency === 'hf') {
                        if (tagTypeValue >= 1100 && tagTypeValue <= 1108) {
                            // NTAG/MF0 - write by pages (4 bytes per page)
                            API.logToConsole('Writing NTAG data...');
                            const pageSize = 4;
                            const totalPages = Math.ceil(fileData.length / pageSize);

                            for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 32) {
                                const pagesThisBatch = Math.min(32, totalPages - pageIndex);
                                const cmdData = new Uint8Array(2 + pagesThisBatch * pageSize);
                                cmdData[0] = pageIndex;
                                cmdData[1] = pagesThisBatch;

                                for (let i = 0; i < pagesThisBatch; i++) {
                                    const srcOffset = (pageIndex + i) * pageSize;
                                    const destOffset = 2 + i * pageSize;
                                    const bytesToCopy = Math.min(pageSize, fileData.length - srcOffset);
                                    cmdData.set(fileData.slice(srcOffset, srcOffset + bytesToCopy), destOffset);
                                }

                                const writeResult = await device.cmd(CMD_MF0_NTAG_WRITE_EMU_PAGE_DATA, cmdData);
                                if (writeResult.status !== 0x68) {
                                    API.logToConsole(`Error writing pages ${pageIndex}-${pageIndex + pagesThisBatch - 1}: Status ${writeResult.status}`, true);
                                    return;
                                }
                            }
                            API.logToConsole(`✓ Wrote ${totalPages} pages`);
                        } else if (tagTypeValue >= 1000 && tagTypeValue <= 1003) {
                            // Mifare Classic - write by blocks (16 bytes per block)
                            API.logToConsole('Writing Mifare Classic data...');
                            const blockSize = 16;
                            const totalBlocks = Math.ceil(fileData.length / blockSize);

                            for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 32) {
                                const blocksThisBatch = Math.min(32, totalBlocks - blockIndex);
                                const cmdData = new Uint8Array(1 + blocksThisBatch * blockSize);
                                cmdData[0] = blockIndex;

                                for (let i = 0; i < blocksThisBatch; i++) {
                                    const srcOffset = (blockIndex + i) * blockSize;
                                    const destOffset = 1 + i * blockSize;
                                    const bytesToCopy = Math.min(blockSize, fileData.length - srcOffset);
                                    cmdData.set(fileData.slice(srcOffset, srcOffset + bytesToCopy), destOffset);
                                }

                                const writeResult = await device.cmd(CMD_MF1_WRITE_EMU_BLOCK_DATA, cmdData);
                                if (writeResult.status !== 0x68) {
                                    API.logToConsole(`Error writing blocks ${blockIndex}-${blockIndex + blocksThisBatch - 1}: Status ${writeResult.status}`, true);
                                    return;
                                }
                            }
                            API.logToConsole(`✓ Wrote ${totalBlocks} blocks`);
                        }
                    } else if (frequency === 'lf') {
                        if (tagTypeValue === 100) {
                            // EM410X - 5 bytes ID
                            if (fileData.length < 5) {
                                API.logToConsole('EM410X requires 5 bytes of data', true);
                                return;
                            }
                            API.logToConsole('Writing EM410X ID...');
                            const writeResult = await device.cmd(CMD_EM410X_SET_EMU_ID, fileData.slice(0, 5));
                            if (writeResult.status !== 0x68) {
                                API.logToConsole(`Error writing EM410X ID: Status ${writeResult.status}`, true);
                                return;
                            }
                            API.logToConsole(`✓ Wrote EM410X ID: ${Array.from(fileData.slice(0, 5)).map(b => b.toString(16).padStart(2, '0')).join('')}`);
                        } else {
                            API.logToConsole(`LF tag type ${tagType} not yet supported for loading`, true);
                            return;
                        }
                    }

                    // Step 3: Save configuration (only if loadflash)
                    if (saveToFlash) {
                        API.logToConsole('Saving to flash...');
                        const saveResult = await device.cmd(CMD_SLOT_DATA_CONFIG_SAVE);
                        if (saveResult.status !== 0x68) {
                            API.logToConsole(`Warning: Failed to save to flash: Status ${saveResult.status}`, true);
                        } else {
                            API.logToConsole('✓ Saved to flash (persistent)');
                        }
                    } else {
                        API.logToConsole('✓ Data loaded to RAM (temporary - will be lost on power cycle)');
                    }

                    API.logToConsole(`✓ Successfully loaded ${tagType} data into slot ${slotNum + 1} ${frequency.toUpperCase()}`);

                } catch (err) {
                    API.logToConsole(`Error loading data: ${err.message}`, true);
                    console.error(err);
                }
            } else if (slotCmd === 'save') {
                // Usage: chameleonultra slot save [slot] <hf|lf> [path]
                if (args.length < 2) {
                    API.logToConsole('Usage: chameleonultra slot save [slot] <hf|lf> [path]', true);
                    API.logToConsole('Examples:');
                    API.logToConsole('  chameleonultra slot save hf                    (saves current slot HF with auto-generated name)');
                    API.logToConsole('  chameleonultra slot save 1 hf                  (saves slot 1 HF with auto-generated name)');
                    API.logToConsole('  chameleonultra slot save 1 hf dumps/           (saves slot 1 HF to dumps/ directory)');
                    API.logToConsole('  chameleonultra slot save lf my_tag.bin         (saves current slot LF to my_tag.bin)');
                    return;
                }

                // Parse arguments - slot number is optional
                let slotNum = null;
                let argOffset = 1;
                const firstArg = args[1];
                const possibleSlotNum = parseInt(firstArg);
                if (!isNaN(possibleSlotNum) && possibleSlotNum >= 1 && possibleSlotNum <= 8 && firstArg === possibleSlotNum.toString()) {
                    slotNum = possibleSlotNum - 1;
                    argOffset = 2;
                }

                if (!args[argOffset]) {
                    API.logToConsole('Must specify hf or lf', true);
                    return;
                }

                const frequency = args[argOffset].toLowerCase();
                if (frequency !== 'hf' && frequency !== 'lf') {
                    API.logToConsole('Frequency must be hf or lf', true);
                    return;
                }

                const userPath = args.slice(argOffset + 1).join(' '); // Optional path

                try {
                    // Get slot number if not specified
                    if (slotNum === null) {
                        const currentSlot = await device.cmd(CMD_GET_ACTIVE_SLOT);
                        if (currentSlot.status !== 0x68) {
                            API.logToConsole('Error reading current slot', true);
                            return;
                        }
                        slotNum = currentSlot.data[0];
                    }

                    // Get slot info to determine tag type
                    const slotInfo = await device.cmd(CMD_GET_SLOT_INFO);
                    if (slotInfo.status !== 0x68) {
                        API.logToConsole('Error reading slot info', true);
                        return;
                    }

                    const slotIndex = slotNum * 4;
                    const hfType = (slotInfo.data[slotIndex] << 8) | slotInfo.data[slotIndex + 1];
                    const lfType = (slotInfo.data[slotIndex + 2] << 8) | slotInfo.data[slotIndex + 3];

                    const tagType = frequency === 'hf' ? hfType : lfType;
                    const tagTypeName = frequency === 'hf' ? getHfTagTypeName(tagType) : getLfTagTypeName(tagType);

                    if (tagType === 0) {
                        API.logToConsole(`Slot ${slotNum + 1} ${frequency.toUpperCase()} is empty`, true);
                        return;
                    }

                    API.logToConsole(`Reading ${frequency.toUpperCase()} data from slot ${slotNum + 1} (${tagTypeName})...`);

                    // Switch to slot if needed
                    const currentSlotCheck = await device.cmd(CMD_GET_ACTIVE_SLOT);
                    if (currentSlotCheck.status === 0x68 && currentSlotCheck.data[0] !== slotNum) {
                        API.logToConsole(`Switching to slot ${slotNum + 1}...`);
                        const switchResult = await device.cmd(CMD_SET_ACTIVE_SLOT, new Uint8Array([slotNum]));
                        if (switchResult.status !== 0x68) {
                            API.logToConsole(`Error switching to slot: Status ${switchResult.status}`, true);
                            return;
                        }
                    }

                    let fileData;

                    // Read data based on tag type
                    if (frequency === 'hf') {
                        if (tagType >= 1100 && tagType <= 1108) {
                            // NTAG/MF0 - read by pages
                            const pageSize = 4;
                            let totalPages;

                            // Determine page count based on tag type
                            const pageCounts = {
                                1100: 45,  // NTAG 213
                                1101: 135, // NTAG 215
                                1102: 231, // NTAG 216
                                1107: 20,  // NTAG 210
                                1108: 41,  // NTAG 212
                            };
                            totalPages = pageCounts[tagType] || 135;

                            const allData = [];
                            for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 32) {
                                const pagesToRead = Math.min(32, totalPages - pageIndex);
                                const cmdData = new Uint8Array([pageIndex, pagesToRead]);
                                const readResult = await device.cmd(CMD_MF0_NTAG_READ_EMU_PAGE_DATA, cmdData);

                                if (readResult.status !== 0x68) {
                                    API.logToConsole(`Error reading pages ${pageIndex}-${pageIndex + pagesToRead - 1}: Status ${readResult.status}`, true);
                                    return;
                                }
                                allData.push(...readResult.data);
                            }
                            fileData = new Uint8Array(allData);
                        } else if (tagType >= 1000 && tagType <= 1003) {
                            // Mifare Classic - read by blocks
                            const blockSize = 16;
                            let totalBlocks;

                            // Determine block count based on tag type
                            const blockCounts = {
                                1000: 20,  // Mini
                                1001: 64,  // 1K
                                1002: 128, // 2K
                                1003: 256, // 4K
                            };
                            totalBlocks = blockCounts[tagType] || 64;

                            const allData = [];
                            for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 32) {
                                const blocksToRead = Math.min(32, totalBlocks - blockIndex);
                                const cmdData = new Uint8Array([blockIndex, blocksToRead]);
                                const readResult = await device.cmd(CMD_MF1_READ_EMU_BLOCK_DATA, cmdData);

                                if (readResult.status !== 0x68) {
                                    API.logToConsole(`Error reading blocks ${blockIndex}-${blockIndex + blocksToRead - 1}: Status ${readResult.status}`, true);
                                    return;
                                }
                                allData.push(...readResult.data);
                            }
                            fileData = new Uint8Array(allData);
                        } else {
                            API.logToConsole(`HF tag type ${tagTypeName} not supported for saving yet`, true);
                            return;
                        }
                    } else if (frequency === 'lf') {
                        if (tagType === 100 || (tagType >= 100 && tagType <= 103)) {
                            // EM410X - 5 bytes
                            const readResult = await device.cmd(CMD_EM410X_GET_EMU_ID);
                            if (readResult.status !== 0x68) {
                                API.logToConsole(`Error reading EM410X ID: Status ${readResult.status}`, true);
                                return;
                            }
                            fileData = readResult.data.slice(0, 5);
                            API.logToConsole(`EM410X ID: ${Array.from(fileData).map(b => b.toString(16).padStart(2, '0')).join('')}`);
                        } else {
                            API.logToConsole(`LF tag type ${tagTypeName} not supported for saving yet`, true);
                            return;
                        }
                    }

                    // Generate filename
                    let filePath;
                    if (userPath) {
                        // User provided path
                        if (userPath.endsWith('/') || userPath.endsWith('\\')) {
                            // Directory provided, generate filename
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
                            const tagTypeSlug = tagTypeName.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
                            filePath = `${userPath}${frequency}_${tagTypeSlug}_${timestamp}.bin`;
                        } else {
                            // Full path provided
                            filePath = userPath;
                        }
                    } else {
                        // Auto-generate filename
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
                        const tagTypeSlug = tagTypeName.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
                        filePath = `${frequency}_${tagTypeSlug}_${timestamp}.bin`;
                    }

                    // Save file
                    const saveSuccess = await API.writeFile(filePath, fileData);
                    if (saveSuccess) {
                        API.logToConsole(`✓ Saved ${fileData.length} bytes to ${filePath}`);
                    } else {
                        API.logToConsole(`Failed to save file: ${filePath}`, true);
                    }

                } catch (err) {
                    API.logToConsole(`Error saving data: ${err.message}`, true);
                    console.error(err);
                }
            } else {
                API.logToConsole(`Unknown slot command: ${slotCmd}`, true);
            }
        });

        API.logToConsole('✓ Chameleon Ultra device extension loaded');
    }

    // Export for direct use
    window.ChameleonUltraBLE = ChameleonUltraBLE;
    window.ChameleonUltraSerial = ChameleonUltraSerial;
})();
