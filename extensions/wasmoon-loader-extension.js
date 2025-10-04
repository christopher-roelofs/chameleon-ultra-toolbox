/**
 * Wasmoon (Lua) Loader Extension
 * @name Lua (Wasmoon)
 * @version 1.0.0
 * @author Toolbox Team
 * @description Lua 5.4 runtime via WebAssembly with device bridge and auto-loading for .lua scripts
 * @source https://github.com/ceifa/wasmoon
 */

const extensionName = 'Wasmoon Loader';

if (!API) {
    console.error(`${extensionName}: API not available`);
    throw new Error('API not available');
}

const { logToConsole, chameleonUltra } = API;

// Track loading state
window.luaReady = false;
window.luaLoading = false;

/**
 * Initialize Wasmoon (Lua) environment
 */
async function initLuaEnvironment() {
    if (window.luaReady) {
        logToConsole('⚡ Lua already loaded');
        return;
    }

    if (window.luaLoading) {
        logToConsole('⏳ Lua is already loading...');
        return;
    }

    try {
        window.luaLoading = true;
        logToConsole('🌙 Loading Wasmoon (Lua 5.4)...');

        // Load Wasmoon from CDN as ES module
        if (!window.wasmoonModule) {
            logToConsole('📦 Downloading Wasmoon from CDN (~100KB)...');
            window.wasmoonModule = await import('https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/+esm');
        }

        // Create Lua engine
        logToConsole('⚙️ Initializing Lua engine...');
        const factory = new window.wasmoonModule.LuaFactory();
        window.lua = await factory.createEngine();

        // Setup logging to app console
        const appLogToConsole = (msg) => {
            const container = document.getElementById("console-container");
            if (container) {
                const div = document.createElement("div");
                div.textContent = msg;
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            }
            console.log(msg);
        };

        // Override Lua's print function to use app console
        window.lua.global.set('app_log', appLogToConsole);

        await window.lua.doString(`
-- Override print to use app console
_original_print = print
function print(...)
    local args = {...}
    local output = ""
    for i, v in ipairs(args) do
        if i > 1 then output = output .. "\\t" end
        output = output .. tostring(v)
    end
    app_log(output)
end
`);

        // Expose ToolboxAPI to Lua so scripts can access device constants
        window.lua.global.set('ToolboxAPI', window.ToolboxAPI);

        // Also create a 'js' object with 'global' property for compatibility
        window.lua.global.set('js', {
            global: window
        });

        // Expose generic device command function to Lua (device-agnostic)
        // Returns a promise that Lua can await
        window.lua.global.set('device_cmd_async', (cmd, data) => {
            const device = window.ToolboxAPI?.chameleonUltra || window.chameleonUltra;

            if (!device) {
                throw new Error('Not connected to any device. Please connect first.');
            }

            // Return a promise that will be awaited by Lua
            return device.cmd(cmd, data).then(result => {
                // Handle both binary response objects and text responses
                if (result && typeof result === 'object') {
                    if (result.data !== undefined) {
                        // Binary response (Chameleon Ultra style)
                        const dataArray = Array.from(result.data);
                        return {
                            cmd: result.cmd,
                            status: result.status,
                            data: dataArray
                        };
                    } else {
                        // Other object response
                        return result;
                    }
                }
                // String response (Bruce style) or null
                return result;
            });
        });

        // Add generic helper utilities to Lua
        await window.lua.doString(`
-- Helper to check if connected
function is_connected()
    -- This will be set from JavaScript side
    return js_connected == true
end

-- Synchronous wrapper for async device command (uses await)
function device_cmd(cmd, data)
    return device_cmd_async(cmd, data):await()
end

-- Helper to sleep (wrapper that awaits the promise)
function sleep(seconds)
    js_sleep_async(seconds * 1000):await()
end

print("✓ Lua device bridge loaded")
print("  - device_cmd(cmd, data) - Send command to connected device")
print("  - is_connected() - Check if device is connected")
print("  - sleep(seconds) - Sleep for N seconds")
print("")
print("Access device constants from JS:")
print("  Use js.global.ToolboxAPI.ChameleonUltra.CMD_GET_BATTERY_INFO")
print("  Use js.global.ToolboxAPI.Bruce.WIFI_SCAN")
`);

        // Set connection status
        const updateConnectionStatus = () => {
            const connected = !!(window.ToolboxAPI?.chameleonUltra || window.chameleonUltra);
            window.lua.global.set('js_connected', connected);
        };
        updateConnectionStatus();

        // Update connection status on device events
        if (API.on) {
            API.on('onDeviceConnected', () => {
                window.lua.global.set('js_connected', true);
            });
            API.on('onDeviceDisconnected', () => {
                window.lua.global.set('js_connected', false);
            });
        }

        window.luaReady = true;
        logToConsole('✅ Lua environment ready!');
        logToConsole('   Lua 5.4 loaded via WebAssembly');
        logToConsole('   Helper functions available');

    } catch (error) {
        logToConsole(`❌ Failed to load Lua: ${error.message}`, true);
        window.luaReady = false;
    } finally {
        window.luaLoading = false;
    }
}

// Register Lua as an extension
API.registerDevice('lua', 'Lua');

// Register Lua file runner
API.registerDeviceCommand('lua', 'lua-run', 'Run Lua file from VFS', async (args) => {
    if (!window.luaReady) {
        logToConsole('⚠️ Lua not ready. Wait for initialization...', true);
        return;
    }

    if (args.length === 0) {
        logToConsole('Usage: lua lua-run <filepath>');
        logToConsole('Example: lua lua-run /scripts/battery.lua');
        return;
    }

    const filepath = args[0];

    try {
        // Read file from VFS
        const luaCode = await API.fs.readFile(filepath);

        logToConsole(`🌙 Running ${filepath}...`);
        logToConsole('─'.repeat(60));

        // Run Lua code
        await window.lua.doString(luaCode);

        logToConsole('─'.repeat(60));
        logToConsole('✓ Script execution complete');
    } catch (error) {
        logToConsole(`❌ Error: ${error.message}`, true);
    }
});

// Hook into script execution to auto-detect .lua files
if (window.runFileFromFS) {
    const originalRunner = window.runFileFromFS;
    window.runFileFromFS = async function(path) {
        // If it's a .lua file, use Lua runner
        if (path.endsWith('.lua')) {
            if (!window.luaReady) {
                console.log('⚠️ Lua not ready. Waiting for initialization...');
                // Wait up to 30 seconds for Lua to load
                for (let i = 0; i < 60; i++) {
                    if (window.luaReady) break;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                if (!window.luaReady) {
                    console.log('❌ Lua still not ready. Please run "lua-init" first.');
                    return;
                }
            }

            try {
                const luaCode = await API.fs.readFile(path);
                console.log(`🌙 Running Lua file: ${path}`);
                console.log('─'.repeat(60));

                await window.lua.doString(luaCode);

                console.log('─'.repeat(60));
                console.log('✓ Lua script completed');
            } catch (error) {
                console.log(`❌ Error: ${error.message}`);
                throw error;
            }
        } else {
            // Run normally for other files
            return originalRunner.call(this, path);
        }
    };
}

logToConsole(`✓ Extension loaded: ${extensionName}`);
logToConsole('  Commands: lua-run');
logToConsole('  .lua files auto-detected in Script Editor');
logToConsole('  Starting Lua background load...');

// Auto-load Lua at startup (asynchronously, don't block)
(async () => {
    await initLuaEnvironment();
})().catch(err => {
    logToConsole(`❌ Async Lua load failed: ${err.message}`, true);
});
