/**
 * RFID Dump Analyzer Script
 * @name RFID Dump Analyzer
 * @version 1.0.0
 * @author Toolbox Team
 * @description Analyzes RFID dump files using the RFID Analyzer extension
 * @source https://github.com/GameTec-live/ChameleonUltra
 */

return (async function() {
    const API = window.ToolboxAPI;

    // Configuration - change this to analyze different files
    const FILE_TO_ANALYZE = 'data/dump.bin';

    try {
        // Check if RFID extension is loaded
        if (!window.rfid) {
            API.logToConsole('Error: RFID extension not loaded', true);
            API.logToConsole('Please enable the rfid extension in the Extensions tab', true);
            return;
        }

        API.logToConsole(`Analyzing ${FILE_TO_ANALYZE}...`);
        API.logToConsole('');

        // Use the exposed RFID instance
        const result = await window.rfid.analyze(FILE_TO_ANALYZE);

        if (result.error) {
            API.logToConsole(`Error: ${result.error}`, true);
            return;
        }

        // Display results using the same format as the analyze command
        displayAnalysis(result, window.rfid);

    } catch (err) {
        API.logToConsole(`Error: ${err.message}`, true);
        console.error(err);
    }

    /**
     * Display formatted analysis results
     */
    function displayAnalysis(result, analyzer) {
        // Header
        API.logToConsole('═══════════════════════════════════════════════════════');
        API.logToConsole('  RFID DUMP ANALYSIS');
        API.logToConsole('═══════════════════════════════════════════════════════');
        API.logToConsole('');

        // Basic Info
        API.logToConsole('┌─ Basic Information');
        API.logToConsole(`│  File Size: ${result.fileSize} bytes (${result.fileSizeBits} bits)`);
        API.logToConsole(`│  Frequency: ${result.frequency || 'Unknown'}`);
        API.logToConsole(`│  Tag Type: ${result.tagType || 'Unknown'}`);
        API.logToConsole(`│  Confidence: ${result.confidence}%`);
        API.logToConsole('└─');
        API.logToConsole('');

        // Details
        if (Object.keys(result.details).length > 0) {
            displayDetails(result);
        }

        // Hex dump preview
        if (result.data && result.data.length > 0) {
            API.logToConsole('┌─ Hex Dump Preview (first 256 bytes)');
            const preview = analyzer.hexDump(result.data.slice(0, 256));
            preview.split('\n').forEach(line => {
                API.logToConsole(`│  ${line}`);
            });
            if (result.data.length > 256) {
                API.logToConsole(`│  ... (${result.data.length - 256} more bytes)`);
            }
            API.logToConsole('└─');
        }
    }

    /**
     * Display detailed information based on tag type
     */
    function displayDetails(result) {
        const details = result.details;

        // UID
        if (details.uid) {
            API.logToConsole('┌─ UID Information');
            API.logToConsole(`│  UID (Hex): ${details.uidHex || Array.from(details.uid).map(b => {
                const byte = typeof b === 'number' ? b : b.charCodeAt(0);
                return byte.toString(16).padStart(2, '0');
            }).join(':').toUpperCase()}`);
            API.logToConsole(`│  UID Length: ${details.uid.length} bytes`);
            if (details.manufacturer) {
                API.logToConsole(`│  Manufacturer: ${details.manufacturer}`);
            }
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // HF-specific details
        if (result.frequency === 'HF') {
            displayHFDetails(details);
        }

        // LF-specific details
        if (result.frequency === 'LF') {
            displayLFDetails(details);
        }

        // Extracted text
        if (details.extractedText && details.extractedText.length > 0) {
            API.logToConsole('┌─ Extracted Text');
            details.extractedText.forEach((text, i) => {
                API.logToConsole(`│  [${i + 1}] "${text}"`);
            });
            API.logToConsole('└─');
            API.logToConsole('');
        }
    }

    /**
     * Display HF-specific details
     */
    function displayHFDetails(details) {
        if (details.totalPages) {
            API.logToConsole('┌─ Memory Structure');
            API.logToConsole(`│  Page Size: ${details.pageSize} bytes`);
            API.logToConsole(`│  Total Pages: ${details.totalPages}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        if (details.totalBlocks) {
            API.logToConsole('┌─ Memory Structure');
            API.logToConsole(`│  Block Size: ${details.blockSize} bytes`);
            API.logToConsole(`│  Total Blocks: ${details.totalBlocks}`);
            API.logToConsole(`│  Sectors: ${details.sectors}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // Capability Container (NTAG)
        if (details.capabilityContainer) {
            API.logToConsole('┌─ Capability Container (CC)');
            API.logToConsole(`│  Raw: ${details.capabilityContainer.raw}`);
            API.logToConsole(`│  Magic: 0x${details.capabilityContainer.magic}`);
            API.logToConsole(`│  Version: ${details.capabilityContainer.version}`);
            API.logToConsole(`│  Memory Size: ${details.capabilityContainer.memorySize} bytes`);
            API.logToConsole(`│  Access: ${details.capabilityContainer.readWrite}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // Lock bytes
        if (details.lockBytes) {
            API.logToConsole('┌─ Lock Status');
            API.logToConsole(`│  Lock Bytes: ${details.lockBytes}`);
            API.logToConsole(`│  Status: ${details.isLocked ? 'Locked' : 'Unlocked'}`);
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // NDEF
        if (details.hasNDEF) {
            API.logToConsole('┌─ NDEF Data');
            API.logToConsole(`│  NDEF Found: Yes`);
            API.logToConsole(`│  Offset: ${details.ndefOffset} (0x${details.ndefOffset.toString(16).padStart(4, '0')})`);
            API.logToConsole(`│  Length: ${details.ndefLength} bytes`);

            if (details.ndef) {
                API.logToConsole('│');
                API.logToConsole(`│  Record Info:`);
                API.logToConsole(`│    Type Name Format: ${details.ndef.typeNameFormatName} (0x${details.ndef.typeNameFormat.toString(16)})`);
                API.logToConsole(`│    Message Begin: ${details.ndef.messageBegin}`);
                API.logToConsole(`│    Message End: ${details.ndef.messageEnd}`);
                API.logToConsole(`│    Short Record: ${details.ndef.shortRecord}`);

                if (details.ndef.type) {
                    API.logToConsole(`│    Type: ${details.ndef.type}`);
                }

                if (details.ndef.payloadText) {
                    API.logToConsole(`│    Payload (Text): "${details.ndef.payloadText}"`);
                } else if (details.ndef.payloadHex) {
                    API.logToConsole(`│    Payload (Hex): ${details.ndef.payloadHex}`);
                }
            }

            API.logToConsole('└─');
            API.logToConsole('');
        } else if (details.hasNDEF === false) {
            API.logToConsole('┌─ NDEF Data');
            API.logToConsole('│  NDEF Found: No');
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // Mifare Classic sector trailers
        if (details.sectorTrailers && details.sectorTrailers.length > 0) {
            API.logToConsole('┌─ Sector Trailers (Keys & Access Bits)');
            details.sectorTrailers.forEach(trailer => {
                API.logToConsole(`│  Sector ${trailer.sector}:`);
                API.logToConsole(`│    Key A: ${trailer.keyA}`);
                API.logToConsole(`│    Access: ${trailer.accessBits}`);
                API.logToConsole(`│    Key B: ${trailer.keyB}`);
            });
            API.logToConsole('└─');
            API.logToConsole('');
        }
    }

    /**
     * Display LF-specific details
     */
    function displayLFDetails(details) {
        // EM410X
        if (details.idHex) {
            API.logToConsole('┌─ EM410X Details');
            API.logToConsole(`│  ID (Hex): ${details.idHex}`);
            API.logToConsole(`│  ID (Decimal): ${details.idDecimal}`);
            if (details.version !== undefined) {
                API.logToConsole(`│  Version: 0x${details.version.toString(16).padStart(2, '0')}`);
            }
            if (details.customerId !== undefined) {
                API.logToConsole(`│  Customer ID: ${details.customerId} (0x${details.customerIdHex})`);
            }
            API.logToConsole('└─');
            API.logToConsole('');
        }

        // T5577
        if (details.blocks && details.blocks.length > 0) {
            API.logToConsole('┌─ T5577 Blocks');
            details.blocks.forEach(block => {
                API.logToConsole(`│  Block ${block.block} (${block.size} bytes):`);
                API.logToConsole(`│    ${block.hex}`);
            });
            API.logToConsole('└─');
            API.logToConsole('');
        }
    }
})();
