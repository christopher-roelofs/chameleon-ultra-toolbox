"""
RFID Dump Analyzer Script (Python)
@name RFID Dump Analyzer (Python)
@version 1.0.0
@author Toolbox Team
@description Analyzes RFID dump files using the RFID Analyzer extension
@source https://github.com/GameTec-live/ChameleonUltra
"""

import asyncio
from js import window, ToolboxAPI

# Configuration - change this to analyze different files
FILE_TO_ANALYZE = 'data/dump.bin'

async def analyze_dump():
    """Analyze RFID dump file"""

    # Check if RFID extension is loaded
    if not hasattr(window, 'rfid') or window.rfid is None:
        print('Error: RFID extension not loaded')
        print('Please enable the rfid extension in the Extensions tab')
        return

    print(f'Analyzing {FILE_TO_ANALYZE}...')
    print('')

    try:
        # Use the exposed RFID instance
        rfid = window.rfid
        result = await rfid.analyze(FILE_TO_ANALYZE)

        # Convert JS object to Python dict
        result_dict = result.to_py()

        if 'error' in result_dict and result_dict['error']:
            print(f"Error: {result_dict['error']}")
            return

        # Display results
        display_analysis(result_dict, rfid)

    except Exception as err:
        print(f'Error: {str(err)}')

def display_analysis(result, analyzer):
    """Display formatted analysis results"""

    # Header
    print('═══════════════════════════════════════════════════════')
    print('  RFID DUMP ANALYSIS')
    print('═══════════════════════════════════════════════════════')
    print('')

    # Basic Info
    print('┌─ Basic Information')
    print(f"│  File Size: {result['fileSize']} bytes ({result['fileSizeBits']} bits)")
    print(f"│  Frequency: {result.get('frequency', 'Unknown')}")
    print(f"│  Tag Type: {result.get('tagType', 'Unknown')}")
    print(f"│  Confidence: {result['confidence']}%")
    print('└─')
    print('')

    # Details
    details = result.get('details', {})
    if details:
        display_details(result, details)

    # Hex dump preview
    if 'data' in result and result['data']:
        print('┌─ Hex Dump Preview (first 256 bytes)')

        # Convert JS array to Python list of integers
        js_data = result['data']
        data = []
        for i in range(len(js_data)):
            val = js_data[i]
            if isinstance(val, int):
                data.append(val)
            elif isinstance(val, str):
                # If it's a string/char, get its byte value
                data.append(ord(val) if len(val) == 1 else int(val))
            else:
                data.append(int(val))

        preview_data = data[:256] if len(data) > 256 else data

        # Generate hex dump
        hex_lines = []
        for i in range(0, len(preview_data), 16):
            chunk = preview_data[i:i+16]
            hex_part = ' '.join(f'{b:02x}' for b in chunk)
            ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
            hex_lines.append(f'{i:04x}:  {hex_part:<48}  {ascii_part}')

        for line in hex_lines:
            print(f'│  {line}')

        if len(data) > 256:
            print(f'│  ... ({len(data) - 256} more bytes)')
        print('└─')

def display_details(result, details):
    """Display detailed information based on tag type"""

    # UID
    if 'uid' in details and details['uid']:
        print('┌─ UID Information')
        js_uid = details['uid']
        # Convert JS array to Python list of integers
        uid = []
        for i in range(len(js_uid)):
            val = js_uid[i]
            if isinstance(val, int):
                uid.append(val)
            elif isinstance(val, str):
                # If it's a string/char, get its byte value
                uid.append(ord(val) if len(val) == 1 else int(val))
            else:
                uid.append(int(val))

        uid_hex = details.get('uidHex') or ':'.join(f'{b:02x}' for b in uid).upper()
        print(f'│  UID (Hex): {uid_hex}')
        print(f'│  UID Length: {len(uid)} bytes')
        if 'manufacturer' in details:
            print(f"│  Manufacturer: {details['manufacturer']}")
        print('└─')
        print('')

    # HF-specific details
    if result.get('frequency') == 'HF':
        display_hf_details(details)

    # LF-specific details
    if result.get('frequency') == 'LF':
        display_lf_details(details)

    # Extracted text
    if 'extractedText' in details and details['extractedText']:
        print('┌─ Extracted Text')
        for i, text in enumerate(details['extractedText']):
            print(f'│  [{i + 1}] "{text}"')
        print('└─')
        print('')

def display_hf_details(details):
    """Display HF-specific details"""

    # Memory structure (pages)
    if 'totalPages' in details:
        print('┌─ Memory Structure')
        print(f"│  Page Size: {details['pageSize']} bytes")
        print(f"│  Total Pages: {details['totalPages']}")
        print('└─')
        print('')

    # Memory structure (blocks)
    if 'totalBlocks' in details:
        print('┌─ Memory Structure')
        print(f"│  Block Size: {details['blockSize']} bytes")
        print(f"│  Total Blocks: {details['totalBlocks']}")
        print(f"│  Sectors: {details['sectors']}")
        print('└─')
        print('')

    # Capability Container (NTAG)
    if 'capabilityContainer' in details:
        cc = details['capabilityContainer']
        print('┌─ Capability Container (CC)')
        print(f"│  Raw: {cc['raw']}")
        print(f"│  Magic: 0x{cc['magic']}")
        print(f"│  Version: {cc['version']}")
        print(f"│  Memory Size: {cc['memorySize']} bytes")
        print(f"│  Access: {cc['readWrite']}")
        print('└─')
        print('')

    # Lock bytes
    if 'lockBytes' in details:
        print('┌─ Lock Status')
        print(f"│  Lock Bytes: {details['lockBytes']}")
        is_locked = details.get('isLocked', False)
        print(f"│  Status: {'Locked' if is_locked else 'Unlocked'}")
        print('└─')
        print('')

    # NDEF
    if 'hasNDEF' in details and details['hasNDEF']:
        print('┌─ NDEF Data')
        print('│  NDEF Found: Yes')
        print(f"│  Offset: {details['ndefOffset']} (0x{details['ndefOffset']:04x})")
        print(f"│  Length: {details['ndefLength']} bytes")

        if 'ndef' in details:
            ndef = details['ndef']
            print('│')
            print('│  Record Info:')
            print(f"│    Type Name Format: {ndef['typeNameFormatName']} (0x{ndef['typeNameFormat']:x})")
            print(f"│    Message Begin: {ndef['messageBegin']}")
            print(f"│    Message End: {ndef['messageEnd']}")
            print(f"│    Short Record: {ndef['shortRecord']}")

            if 'type' in ndef and ndef['type']:
                print(f"│    Type: {ndef['type']}")

            if 'payloadText' in ndef and ndef['payloadText']:
                print(f"│    Payload (Text): \"{ndef['payloadText']}\"")
            elif 'payloadHex' in ndef and ndef['payloadHex']:
                print(f"│    Payload (Hex): {ndef['payloadHex']}")

        print('└─')
        print('')
    elif 'hasNDEF' in details and not details['hasNDEF']:
        print('┌─ NDEF Data')
        print('│  NDEF Found: No')
        print('└─')
        print('')

    # Mifare Classic sector trailers
    if 'sectorTrailers' in details and details['sectorTrailers']:
        print('┌─ Sector Trailers (Keys & Access Bits)')
        for trailer in details['sectorTrailers']:
            print(f"│  Sector {trailer['sector']}:")
            print(f"│    Key A: {trailer['keyA']}")
            print(f"│    Access: {trailer['accessBits']}")
            print(f"│    Key B: {trailer['keyB']}")
        print('└─')
        print('')

def display_lf_details(details):
    """Display LF-specific details"""

    # EM410X
    if 'idHex' in details:
        print('┌─ EM410X Details')
        print(f"│  ID (Hex): {details['idHex']}")
        print(f"│  ID (Decimal): {details['idDecimal']}")
        if 'version' in details:
            print(f"│  Version: 0x{details['version']:02x}")
        if 'customerId' in details:
            print(f"│  Customer ID: {details['customerId']} (0x{details['customerIdHex']})")
        print('└─')
        print('')

    # T5577
    if 'blocks' in details and details['blocks']:
        print('┌─ T5577 Blocks')
        for block in details['blocks']:
            print(f"│  Block {block['block']} ({block['size']} bytes):")
            print(f"│    {block['hex']}")
        print('└─')
        print('')

# Run the analysis
await analyze_dump()
