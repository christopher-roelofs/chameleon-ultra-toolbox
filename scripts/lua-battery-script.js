/**
 * Lua Battery Analysis Script
 *
 * This script uses Wasmoon (Lua 5.4) loaded by wasmoon-loader-extension.
 * Demonstrates Lua scripting for Chameleon Ultra battery analysis.
 *
 * Usage:
 * 1. Make sure wasmoon-loader-extension.js is enabled
 * 2. Upload this script to /scripts folder
 * 3. Load and run from Script Editor
 */

(async function() {
    // Check if Lua is ready
    if (!window.lua || !window.luaReady) {
        console.log('❌ Lua not loaded. Please enable wasmoon-loader-extension first.');
        console.log('   Or run "lua-init" command to load Lua.');
        return;
    }

    console.log('🌙 Running Lua Battery Analysis...');
    console.log('─'.repeat(60));

    // Print header from Lua
    await window.lua.doString(`
print("============================================================")
print("🔋 CHAMELEON ULTRA BATTERY ANALYSIS (LUA)")
print("============================================================")

if not is_connected() then
    print("❌ Not connected to Chameleon Ultra")
    error("Not connected")
end

print("")
print("📊 Collecting 10 battery samples...")
`);

    // Collect samples sequentially from JavaScript (properly async)
    const samples = [];
    const chameleon = window.ChameleonAPI?.chameleonUltra || window.chameleonUltra;

    if (!chameleon) {
        await window.lua.doString(`print("❌ Not connected to Chameleon Ultra")`);
        console.log('─'.repeat(60));
        console.log('❌ Not connected');
        return;
    }

    for (let i = 0; i < 10; i++) {
        try {
            // Call BLE directly from JavaScript
            const result = await chameleon.cmd(1025, null, true); // CMD_GET_BATTERY_INFO

            if (result && result.data) {
                const voltage = (result.data[1] << 8) | result.data[0];
                const percentage = result.data[2] || 0;

                samples.push({
                    voltage: voltage,
                    percentage: percentage
                });

                if ((i + 1) % 3 === 0) {
                    await window.lua.doString(`print("  Progress: ${i + 1}/10 samples...")`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        } catch (err) {
            console.log(`Error collecting sample ${i + 1}: ${err.message}`);
        }
    }

    // Pass samples to Lua for analysis
    window.lua.global.set('js_samples', samples);

    // Lua script to analyze the collected data
    const luaCode = `
local voltages = {}
local percentages = {}

-- Extract data from JS samples
for i, sample in ipairs(js_samples) do
    table.insert(voltages, sample.voltage)
    table.insert(percentages, sample.percentage)
end

if #voltages < 5 then
    print("❌ Insufficient data collected")
    return
end

print(string.format("✓ Collected %d samples", #voltages))

-- Calculate statistics
local function mean(t)
    local sum = 0
    for _, v in ipairs(t) do
        sum = sum + v
    end
    return sum / #t
end

local function min(t)
    local m = t[1]
    for _, v in ipairs(t) do
        if v < m then m = v end
    end
    return m
end

local function max(t)
    local m = t[1]
    for _, v in ipairs(t) do
        if v > m then m = v end
    end
    return m
end

local function stddev(t)
    local m = mean(t)
    local sum = 0
    for _, v in ipairs(t) do
        sum = sum + (v - m)^2
    end
    return math.sqrt(sum / #t)
end

-- Voltage statistics
local v_mean = mean(voltages)
local v_min = min(voltages)
local v_max = max(voltages)
local v_std = stddev(voltages)

-- Percentage statistics
local p_mean = mean(percentages)
local p_current = percentages[#percentages]

print("")
print("============================================================")
print("📊 BATTERY STATISTICS")
print("============================================================")

print("")
print("Voltage:")
print(string.format("  Mean:     %.1f mV", v_mean))
print(string.format("  Min:      %d mV", v_min))
print(string.format("  Max:      %d mV", v_max))
print(string.format("  Std Dev:  %.1f mV", v_std))
print(string.format("  Range:    %d mV", v_max - v_min))

print("")
print("Battery Level:")
print(string.format("  Mean:     %.1f%%", p_mean))
print(string.format("  Current:  %d%%", p_current))

-- Trend analysis (simple linear regression)
local function linear_trend(values)
    local n = #values
    local sum_x = 0
    local sum_y = 0
    local sum_xy = 0
    local sum_x2 = 0

    for i, y in ipairs(values) do
        local x = i - 1
        sum_x = sum_x + x
        sum_y = sum_y + y
        sum_xy = sum_xy + (x * y)
        sum_x2 = sum_x2 + (x * x)
    end

    local slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
    return slope
end

local trend = linear_trend(voltages)

print("")
print("============================================================")
print("📈 TREND ANALYSIS")
print("============================================================")

print("")
if math.abs(trend) < 0.5 then
    print("  Status: 🟢 STABLE")
    print(string.format("  Change: %.3f mV/sample (negligible)", trend))
elseif trend > 0 then
    print("  Status: 📈 CHARGING")
    print(string.format("  Rate: +%.2f mV/sample", trend))
else
    print("  Status: 📉 DRAINING")
    print(string.format("  Rate: %.2f mV/sample", trend))
end

-- Health assessment
print("")
print("============================================================")
print("🏥 HEALTH ASSESSMENT")
print("============================================================")

local level_score = math.min(100, p_mean)
local stability_score = math.max(0, 100 - v_std)
local health_score = level_score * 0.7 + stability_score * 0.3

print("")
print(string.format("  Battery Level:    %.1f/100", level_score))
print(string.format("  Stability:        %.1f/100", stability_score))
print(string.format("  Overall Score:    %.1f/100", health_score))

local verdict
if health_score >= 80 then
    verdict = "✅ EXCELLENT"
elseif health_score >= 60 then
    verdict = "🟡 GOOD"
elseif health_score >= 40 then
    verdict = "🟠 FAIR"
else
    verdict = "🔴 POOR"
end

print("")
print("  Verdict: " .. verdict)

-- Recommendations
print("")
print("============================================================")
print("💡 RECOMMENDATIONS")
print("============================================================")

local has_recommendations = false

if p_mean < 20 then
    print("  ⚡ Charge battery immediately")
    has_recommendations = true
elseif p_mean < 50 then
    print("  🔋 Consider charging soon")
    has_recommendations = true
end

if v_std > 50 then
    print("  📡 Check BLE connection stability")
    has_recommendations = true
end

if trend < -1 then
    print("  ⏰ Battery draining quickly")
    has_recommendations = true
end

if not has_recommendations then
    print("  ✅ Battery is healthy, no action needed")
end

print("")
print("============================================================")
print("✓ Analysis complete!")
print("============================================================")
`;

    try {
        // Wrap in async context so promises are properly awaited
        const wrappedCode = `
local function main()
${luaCode}
end
main()
`;
        await window.lua.doString(wrappedCode);
        console.log('─'.repeat(60));
        console.log('✅ Lua script completed');
    } catch (error) {
        console.log('❌ Error: ' + error.message);
        throw error;
    }

})();
