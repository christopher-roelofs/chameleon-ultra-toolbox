// Example script: Get battery status and display percentage
// This script can be uploaded and executed from the Script Manager

(async function() {
    // Check if device is connected
    if (!chameleonUltra || !chameleonUltra.device || !chameleonUltra.device.gatt.connected) {
        logToConsole('❌ Device not connected! Please connect first.', true);
        return;
    }

    logToConsole('🔋 Checking battery status...');

    try {
        // Send GET_BATTERY_INFO command (1025)
        const response = await chameleonUltra.cmd(CMD_GET_BATTERY_INFO);

        // Check if command was successful
        if (response.status !== 0x68) { // 0x68 = SUCCESS
            logToConsole(`❌ Command failed with status: 0x${response.status.toString(16)}`, true);
            return;
        }

        // Parse battery data
        // Response format: voltage(uint16, mV) + percentage(uint8)
        if (response.data.length >= 3) {
            const voltage = (response.data[0] << 8) | response.data[1]; // Big-endian uint16
            const percentage = response.data[2]; // uint8

            logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');
            logToConsole(`🔋 Battery Level: ${percentage}%`);
            logToConsole(`⚡ Voltage: ${voltage} mV (${(voltage / 1000).toFixed(2)}V)`);
            logToConsole('━━━━━━━━━━━━━━━━━━━━━━━');

            // Show warning if battery is low
            if (percentage < 20) {
                logToConsole('⚠️  Low battery! Please charge soon.', true);
            } else if (percentage < 50) {
                logToConsole('ℹ️  Battery is getting low.');
            } else {
                logToConsole('✓ Battery level is good.');
            }

            // Return data for programmatic use
            return { voltage, percentage };
        } else {
            logToConsole('❌ Unexpected response data format', true);
        }
    } catch (error) {
        logToConsole(`❌ Error: ${error.message}`, true);
    }
})();
