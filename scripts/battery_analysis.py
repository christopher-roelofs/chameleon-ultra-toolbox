"""
Battery Analysis Script (Python)
@name Battery Analysis (Python)
@version 1.0.0
@author Toolbox Team
@description Advanced battery analysis with NumPy statistics, trend analysis, and health scoring
@source https://github.com/GameTec-live/ChameleonUltra
"""

import asyncio
import numpy as np
from js import ToolboxAPI

# Import constants from Chameleon Ultra device extension
# (Device extension exports these, not hardcoded here!)
CMD_GET_BATTERY_INFO = ToolboxAPI.ChameleonUltra.CMD_GET_BATTERY_INFO

async def get_battery():
    """Get battery info using device extension"""
    result = await device_cmd(CMD_GET_BATTERY_INFO, None)
    if result and result['data']:
        data = result['data']
        voltage = (data[1] << 8) | data[0]
        percentage = data[2] if len(data) > 2 else 0
        return {'voltage': voltage, 'percentage': percentage}
    return None

async def analyze_battery():
    """
    Comprehensive battery analysis
    """
    print("=" * 60)
    print("🔋 BATTERY ANALYSIS")
    print("=" * 60)

    # Check connection
    if not is_connected():
        print("❌ Not connected to device")
        return

    # Collect 15 battery samples
    print("\n📊 Collecting 15 samples over 7.5 seconds...")

    voltages = []
    percentages = []

    for i in range(15):
        try:
            battery = await get_battery()

            if battery:
                voltages.append(battery['voltage'])
                percentages.append(battery['percentage'])

                if (i + 1) % 5 == 0:
                    print(f"  Progress: {i + 1}/15 samples...")

            await asyncio.sleep(0.5)

        except Exception as e:
            print(f"❌ Error: {str(e)}")
            break

    if len(voltages) < 5:
        print("❌ Insufficient data collected")
        return

    # Convert to NumPy arrays
    v_arr = np.array(voltages)
    p_arr = np.array(percentages)

    print(f"\n✓ Collected {len(voltages)} samples")

    # === STATISTICS ===
    print("\n" + "=" * 60)
    print("📊 BATTERY STATISTICS")
    print("=" * 60)

    print(f"\nVoltage:")
    print(f"  Mean:     {np.mean(v_arr):.1f} mV")
    print(f"  Median:   {np.median(v_arr):.1f} mV")
    print(f"  Std Dev:  {np.std(v_arr):.1f} mV")
    print(f"  Range:    {np.min(v_arr)} - {np.max(v_arr)} mV")

    print(f"\nBattery Level:")
    print(f"  Mean:     {np.mean(p_arr):.1f}%")
    print(f"  Median:   {np.median(p_arr):.1f}%")
    print(f"  Current:  {p_arr[-1]}%")

    # === TREND ANALYSIS ===
    print("\n" + "=" * 60)
    print("📈 TREND ANALYSIS")
    print("=" * 60)

    # Calculate trend (linear regression)
    trend = np.polyfit(range(len(v_arr)), v_arr, 1)[0]

    if abs(trend) < 0.5:
        status = "🟢 STABLE"
        print(f"\n  Status: {status}")
        print(f"  Change: {trend:.3f} mV/sample (negligible)")
    elif trend > 0:
        status = "📈 CHARGING"
        print(f"\n  Status: {status}")
        print(f"  Rate: +{trend:.2f} mV/sample")
    else:
        status = "📉 DRAINING"
        print(f"\n  Status: {status}")
        print(f"  Rate: {trend:.2f} mV/sample")

    # === HEALTH ASSESSMENT ===
    print("\n" + "=" * 60)
    print("🏥 HEALTH ASSESSMENT")
    print("=" * 60)

    level = np.mean(p_arr)
    stability = max(0, 100 - np.std(v_arr))
    health_score = level * 0.7 + stability * 0.3

    print(f"\n  Battery Level:    {level:.1f}/100")
    print(f"  Stability:        {stability:.1f}/100")
    print(f"  Overall Score:    {health_score:.1f}/100")

    if health_score >= 80:
        verdict = "✅ EXCELLENT"
    elif health_score >= 60:
        verdict = "🟡 GOOD"
    elif health_score >= 40:
        verdict = "🟠 FAIR"
    else:
        verdict = "🔴 POOR"

    print(f"\n  Verdict: {verdict}")

    # === RECOMMENDATIONS ===
    print("\n" + "=" * 60)
    print("💡 RECOMMENDATIONS")
    print("=" * 60)

    if level < 20:
        print("  ⚡ Charge battery immediately")
    elif level < 50:
        print("  🔋 Consider charging soon")

    if np.std(v_arr) > 50:
        print("  📡 Check BLE connection stability")

    if trend < -1:
        print("  ⏰ Battery draining quickly")

    print("\n" + "=" * 60)
    print("✓ Analysis complete!")

# Run the analysis
await analyze_battery()
