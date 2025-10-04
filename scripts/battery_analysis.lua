--[[
Battery Analysis Script (Lua)
@name Battery Analysis (Lua)
@version 1.0.0
@author Toolbox Team
@description Battery analysis with statistics, trend analysis, and health scoring in pure Lua
@source https://github.com/GameTec-live/ChameleonUltra
--]]

-- Import constants from Chameleon Ultra device extension
-- (Device extension exports these, not hardcoded here!)
local CMD_GET_BATTERY_INFO = js.global.ToolboxAPI.ChameleonUltra.CMD_GET_BATTERY_INFO

-- Helper function to get battery info using device extension
local function get_battery()
    local result = device_cmd(CMD_GET_BATTERY_INFO, nil)
    if result and result.data then
        local voltage = result.data[1] + (result.data[2] * 256)
        local percentage = result.data[3] or 0
        return {voltage = voltage, percentage = percentage}
    end
    return nil
end

-- Battery Analysis Script in Lua
print("============================================================")
print("🔋 BATTERY ANALYSIS (LUA)")
print("============================================================")

-- Check connection
if not is_connected() then
    print("❌ Not connected to device")
    return
end

-- Note: Sample collection must be done from JavaScript side due to async limitations
-- This script focuses on analysis of pre-collected data

-- For now, let's do a simple demo with a few samples
print("")
print("📊 Collecting battery samples...")
print("  (Using device bridge functions)")

local samples = {}
local sample_count = 5

-- Collect samples (these are synchronous Lua calls that wrap async JS)
for i = 1, sample_count do
    local battery = get_battery()

    if battery then
        table.insert(samples, {
            voltage = battery.voltage,
            percentage = battery.percentage
        })
        print(string.format("  Sample %d: %dmV (%d%%)", i, battery.voltage, battery.percentage))
    end
end

if #samples < 3 then
    print("❌ Insufficient data collected")
    return
end

print(string.format("\n✓ Collected %d samples", #samples))

-- Calculate statistics
local function mean(t, key)
    local sum = 0
    for _, v in ipairs(t) do
        sum = sum + v[key]
    end
    return sum / #t
end

local function min(t, key)
    local m = t[1][key]
    for _, v in ipairs(t) do
        if v[key] < m then m = v[key] end
    end
    return m
end

local function max(t, key)
    local m = t[1][key]
    for _, v in ipairs(t) do
        if v[key] > m then m = v[key] end
    end
    return m
end

local function stddev(t, key)
    local m = mean(t, key)
    local sum = 0
    for _, v in ipairs(t) do
        sum = sum + (v[key] - m)^2
    end
    return math.sqrt(sum / #t)
end

-- Voltage statistics
local v_mean = mean(samples, 'voltage')
local v_min = min(samples, 'voltage')
local v_max = max(samples, 'voltage')
local v_std = stddev(samples, 'voltage')

-- Percentage statistics
local p_mean = mean(samples, 'percentage')
local p_current = samples[#samples].percentage

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
local function linear_trend(data, key)
    local n = #data
    local sum_x = 0
    local sum_y = 0
    local sum_xy = 0
    local sum_x2 = 0

    for i, item in ipairs(data) do
        local x = i - 1
        local y = item[key]
        sum_x = sum_x + x
        sum_y = sum_y + y
        sum_xy = sum_xy + (x * y)
        sum_x2 = sum_x2 + (x * x)
    end

    local slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
    return slope
end

local trend = linear_trend(samples, 'voltage')

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
