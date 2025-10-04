--[[
RFID Dump Analyzer Script (Lua)
@name RFID Dump Analyzer (Lua)
@version 1.0.0
@author Toolbox Team
@description Analyzes RFID dump files using the RFID Analyzer extension
@source https://github.com/GameTec-live/ChameleonUltra
--]]

-- Configuration - change this to analyze different files
local FILE_TO_ANALYZE = 'data/dump.bin'

-- Check if RFID extension is loaded
if not js.global.rfid then
    print('Error: RFID extension not loaded')
    print('Please enable the rfid extension in the Extensions tab')
    return
end

print('Analyzing ' .. FILE_TO_ANALYZE .. '...')
print('')

-- Get RFID instance
local rfid = js.global.rfid

-- Analyze the file
local result = rfid:analyze(FILE_TO_ANALYZE):await()

-- Check for errors (JS object access)
if result.error then
    print('Error: ' .. tostring(result.error))
    return
end

-- Helper function to convert JS array to Lua table
local function js_array_to_table(js_array)
    if not js_array then return {} end
    local t = {}
    local len = js_array.length or 0
    for i = 0, len - 1 do
        t[i + 1] = js_array[i]
    end
    return t
end

-- Helper to safely get JS property
local function get_prop(obj, key, default)
    local val = obj[key]
    if val == nil then return default end
    return val
end

-- Forward declarations
local display_details, display_hf_details, display_lf_details

-- Display formatted analysis results
local function display_analysis(result, rfid)
    -- Header
    print('═══════════════════════════════════════════════════════')
    print('  RFID DUMP ANALYSIS')
    print('═══════════════════════════════════════════════════════')
    print('')

    -- Basic Info (access JS properties)
    print('┌─ Basic Information')
    print(string.format('│  File Size: %s bytes (%s bits)', tostring(result.fileSize), tostring(result.fileSizeBits)))
    print(string.format('│  Frequency: %s', tostring(result.frequency or 'Unknown')))
    print(string.format('│  Tag Type: %s', tostring(result.tagType or 'Unknown')))
    print(string.format('│  Confidence: %s%%', tostring(result.confidence)))
    print('└─')
    print('')

    -- Details (check if details object exists)
    local details = result.details
    if details then
        display_details(result, details)
    end

    -- Hex dump preview
    if result.data then
        print('┌─ Hex Dump Preview (first 256 bytes)')

        -- Note: Hex dump skipped in Lua due to binary data encoding limitations
        -- Use JavaScript or Python analyzer for hex dump display
        local data_len = tonumber(result.fileSize) or 0
        if data_len > 0 then
            print('│  [Hex dump available in JS/Python versions - ' .. data_len .. ' bytes total]')
        else
            print('│  (no data)')
        end
        print('└─')
    end
end

-- Display detailed information based on tag type
display_details = function(result, details)
    -- UID
    if details.uid then
        print('┌─ UID Information')
        local uid = js_array_to_table(details.uid)
        local uid_hex_parts = {}
        for _, b in ipairs(uid) do
            -- Handle both number and string/char values
            local byte_val = type(b) == 'number' and b or string.byte(b)
            table.insert(uid_hex_parts, string.format('%02X', byte_val))
        end
        local uid_hex = tostring(details.uidHex or table.concat(uid_hex_parts, ':'))
        print('│  UID (Hex): ' .. uid_hex)
        print(string.format('│  UID Length: %d bytes', #uid))
        if details.manufacturer then
            print('│  Manufacturer: ' .. tostring(details.manufacturer))
        end
        print('└─')
        print('')
    end

    -- HF-specific details
    if result.frequency == 'HF' then
        display_hf_details(details)
    end

    -- LF-specific details
    if result.frequency == 'LF' then
        display_lf_details(details)
    end

    -- Extracted text
    if details.extractedText then
        local texts = js_array_to_table(details.extractedText)
        if #texts > 0 then
            print('┌─ Extracted Text')
            for i, text in ipairs(texts) do
                print(string.format('│  [%d] "%s"', i, text))
            end
            print('└─')
            print('')
        end
    end
end

-- Display HF-specific details
display_hf_details = function(details)
    -- Memory structure (pages)
    if details.totalPages then
        print('┌─ Memory Structure')
        print(string.format('│  Page Size: %d bytes', details.pageSize))
        print(string.format('│  Total Pages: %d', details.totalPages))
        print('└─')
        print('')
    end

    -- Memory structure (blocks)
    if details.totalBlocks then
        print('┌─ Memory Structure')
        print(string.format('│  Block Size: %d bytes', details.blockSize))
        print(string.format('│  Total Blocks: %d', details.totalBlocks))
        print(string.format('│  Sectors: %d', details.sectors))
        print('└─')
        print('')
    end

    -- Capability Container (NTAG)
    if details.capabilityContainer then
        local cc = details.capabilityContainer
        print('┌─ Capability Container (CC)')
        print('│  Raw: ' .. tostring(cc.raw))
        print('│  Magic: 0x' .. tostring(cc.magic))
        print('│  Version: ' .. tostring(cc.version))
        print(string.format('│  Memory Size: %d bytes', cc.memorySize))
        print('│  Access: ' .. tostring(cc.readWrite))
        print('└─')
        print('')
    end

    -- Lock bytes
    if details.lockBytes then
        print('┌─ Lock Status')
        print('│  Lock Bytes: ' .. tostring(details.lockBytes))
        local is_locked = details.isLocked or false
        print(string.format('│  Status: %s', is_locked and 'Locked' or 'Unlocked'))
        print('└─')
        print('')
    end

    -- NDEF
    if details.hasNDEF == true then
        print('┌─ NDEF Data')
        print('│  NDEF Found: Yes')
        print(string.format('│  Offset: %d (0x%04x)', details.ndefOffset, details.ndefOffset))
        print(string.format('│  Length: %d bytes', details.ndefLength))

        if details.ndef then
            local ndef = details.ndef
            print('│')
            print('│  Record Info:')
            print(string.format('│    Type Name Format: %s (0x%x)', ndef.typeNameFormatName, ndef.typeNameFormat))
            print(string.format('│    Message Begin: %s', tostring(ndef.messageBegin)))
            print(string.format('│    Message End: %s', tostring(ndef.messageEnd)))
            print(string.format('│    Short Record: %s', tostring(ndef.shortRecord)))

            if ndef.type then
                print('│    Type: ' .. tostring(ndef.type))
            end

            if ndef.payloadText then
                print('│    Payload (Text): "' .. tostring(ndef.payloadText) .. '"')
            elseif ndef.payloadHex then
                print('│    Payload (Hex): ' .. tostring(ndef.payloadHex))
            end
        end

        print('└─')
        print('')
    elseif details.hasNDEF == false then
        print('┌─ NDEF Data')
        print('│  NDEF Found: No')
        print('└─')
        print('')
    end

    -- Mifare Classic sector trailers
    if details.sectorTrailers then
        local trailers = js_array_to_table(details.sectorTrailers)
        if #trailers > 0 then
            print('┌─ Sector Trailers (Keys & Access Bits)')
            for _, trailer in ipairs(trailers) do
                print(string.format('│  Sector %d:', trailer.sector))
                print('│    Key A: ' .. tostring(trailer.keyA))
                print('│    Access: ' .. tostring(trailer.accessBits))
                print('│    Key B: ' .. tostring(trailer.keyB))
            end
            print('└─')
            print('')
        end
    end
end

-- Display LF-specific details
display_lf_details = function(details)
    -- EM410X
    if details.idHex then
        print('┌─ EM410X Details')
        print('│  ID (Hex): ' .. tostring(details.idHex))
        print('│  ID (Decimal): ' .. tostring(details.idDecimal))
        if details.version then
            print(string.format('│  Version: 0x%02x', details.version))
        end
        if details.customerId then
            print(string.format('│  Customer ID: %d (0x%s)', details.customerId, details.customerIdHex))
        end
        print('└─')
        print('')
    end

    -- T5577
    if details.blocks then
        local blocks = js_array_to_table(details.blocks)
        if #blocks > 0 then
            print('┌─ T5577 Blocks')
            for _, block in ipairs(blocks) do
                print(string.format('│  Block %d (%d bytes):', block.block, block.size))
                print('│    ' .. tostring(block.hex))
            end
            print('└─')
            print('')
        end
    end
end

-- Run the analysis
display_analysis(result, rfid)
