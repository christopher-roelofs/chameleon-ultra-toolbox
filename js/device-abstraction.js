/**
 * Device Abstraction Layer
 * Provides base classes and interfaces for device support
 */

// Base transport class
class Transport {
    async connect() {
        throw new Error('connect() must be implemented by subclass');
    }

    async disconnect() {
        throw new Error('disconnect() must be implemented by subclass');
    }

    async send(data) {
        throw new Error('send() must be implemented by subclass');
    }

    async receive() {
        throw new Error('receive() must be implemented by subclass');
    }

    isConnected() {
        throw new Error('isConnected() must be implemented by subclass');
    }
}

// BLE Transport
class BLETransport extends Transport {
    constructor() {
        super();
        this.device = null;
        this.server = null;
        this.service = null;
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
        this.responseQueue = [];
        this.onDataCallback = null;
    }

    async connect(options = {}) {
        const {
            serviceUUID,
            txCharacteristicUUID,
            rxCharacteristicUUID,
            filters = []
        } = options;

        // BLE requires either filters OR acceptAllDevices
        const requestOptions = filters.length > 0
            ? { filters: filters, optionalServices: [serviceUUID] }
            : { acceptAllDevices: true, optionalServices: [serviceUUID] };

        this.device = await navigator.bluetooth.requestDevice(requestOptions);

        this.server = await this.device.gatt.connect();
        this.service = await this.server.getPrimaryService(serviceUUID);

        this.txCharacteristic = await this.service.getCharacteristic(txCharacteristicUUID);
        this.rxCharacteristic = await this.service.getCharacteristic(rxCharacteristicUUID);

        // Start notifications
        await this.rxCharacteristic.startNotifications();
        this.rxCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            const data = new Uint8Array(event.target.value.buffer);
            console.log('🔔 BLE characteristic event fired:', data.length, 'bytes', 'onDataCallback exists?', !!this.onDataCallback);
            this.responseQueue.push(data);
            if (this.onDataCallback) {
                this.onDataCallback(data);
            }
        });
    }

    async disconnect() {
        if (this.server) {
            await this.server.disconnect();
            this.server = null;
        }
        this.device = null;
        this.service = null;
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
    }

    async send(data) {
        if (!this.txCharacteristic) {
            throw new Error('Not connected');
        }
        console.log('💾 Writing to BLE characteristic:', this.txCharacteristic.uuid, 'data:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        await this.txCharacteristic.writeValue(data);
        console.log('✓ Write complete');
    }

    async receive(timeout = 5000) {
        const startTime = Date.now();
        while (this.responseQueue.length === 0) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Receive timeout');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return this.responseQueue.shift();
    }

    isConnected() {
        return this.server !== null && this.server.connected;
    }

    onData(callback) {
        this.onDataCallback = callback;
    }
}

// Serial Transport
class SerialTransport extends Transport {
    constructor() {
        super();
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.readBuffer = new Uint8Array(0);
        this.reading = false;
        this.onDataCallback = null;
    }

    async connect(options = {}) {
        const { baudRate = 115200 } = options;

        // Check if Web Serial API is available
        if (!navigator.serial) {
            throw new Error('Web Serial API not supported in this browser. Please use Chrome, Edge, or Opera.');
        }

        console.log('📡 Requesting Serial port...');
        this.port = await navigator.serial.requestPort();
        console.log('✓ Serial port selected:', this.port);

        console.log(`🔌 Opening port at ${baudRate} baud...`);
        await this.port.open({ baudRate });
        console.log('✓ Port opened');

        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();

        // Start read loop
        this.reading = true;
        this.startReadLoop();
    }

    async startReadLoop() {
        console.log('🔁 Serial read loop starting...');
        try {
            while (this.reading && this.reader) {
                const { value, done } = await this.reader.read();
                if (done) {
                    console.log('📭 Serial read loop done');
                    break;
                }

                console.log('📨 Serial raw read:', value.length, 'bytes');

                // Append to buffer
                const newBuffer = new Uint8Array(this.readBuffer.length + value.length);
                newBuffer.set(this.readBuffer);
                newBuffer.set(value, this.readBuffer.length);
                this.readBuffer = newBuffer;

                if (this.onDataCallback) {
                    this.onDataCallback(value);
                } else {
                    console.log('⚠️  No onDataCallback set!');
                }
            }
        } catch (error) {
            if (this.reading) {
                console.error('Serial read error:', error);
            }
        }
        console.log('🛑 Serial read loop ended');
    }

    async disconnect() {
        this.reading = false;

        if (this.reader) {
            await this.reader.cancel();
            this.reader.releaseLock();
            this.reader = null;
        }
        if (this.writer) {
            this.writer.releaseLock();
            this.writer = null;
        }
        if (this.port) {
            await this.port.close();
            this.port = null;
        }
    }

    async send(data) {
        if (!this.writer) {
            throw new Error('Not connected');
        }
        console.log('💾 Writing to Serial port:', data.length, 'bytes');
        await this.writer.write(data);
        console.log('✓ Serial write complete');
    }

    async receive(length, timeout = 5000) {
        const startTime = Date.now();
        while (this.readBuffer.length < length) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Receive timeout');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        const data = this.readBuffer.slice(0, length);
        this.readBuffer = this.readBuffer.slice(length);
        return data;
    }

    isConnected() {
        return this.port !== null && this.writer !== null;
    }

    onData(callback) {
        this.onDataCallback = callback;
    }

    getBuffer() {
        return this.readBuffer;
    }

    clearBuffer() {
        this.readBuffer = new Uint8Array(0);
    }
}

// Base Device class
class Device {
    constructor(name, capabilities = []) {
        this.name = name;
        this.capabilities = capabilities;
        this.transport = null;
    }

    async connect(transportType = 'ble', options = {}) {
        throw new Error('connect() must be implemented by device class');
    }

    async disconnect() {
        if (this.transport) {
            await this.transport.disconnect();
            this.transport = null;
        }
    }

    isConnected() {
        return this.transport && this.transport.isConnected();
    }

    hasCapability(capability) {
        return this.capabilities.includes(capability);
    }

    // Command interface - to be implemented by device classes
    async sendCommand(command, data = null) {
        throw new Error('sendCommand() must be implemented by device class');
    }
}

// Device Registry
class DeviceRegistry {
    constructor() {
        this.devices = new Map();
        this.activeDevice = null;
    }

    register(deviceClass, metadata = {}) {
        const { id, name, description, capabilities = [] } = metadata;
        if (!id) {
            throw new Error('Device must have an id');
        }

        this.devices.set(id, {
            class: deviceClass,
            metadata: { id, name, description, capabilities }
        });
    }

    unregister(id) {
        this.devices.delete(id);
    }

    getDevice(id) {
        return this.devices.get(id);
    }

    getAllDevices() {
        return Array.from(this.devices.values()).map(d => d.metadata);
    }

    createDevice(id) {
        const deviceInfo = this.devices.get(id);
        if (!deviceInfo) {
            throw new Error(`Device ${id} not found`);
        }
        return new deviceInfo.class();
    }

    async connectDevice(id, transportType = 'ble', options = {}) {
        const device = this.createDevice(id);
        await device.connect(transportType, options);
        this.activeDevice = device;
        return device;
    }

    async disconnectActive() {
        if (this.activeDevice) {
            await this.activeDevice.disconnect();
            this.activeDevice = null;
        }
    }

    getActive() {
        return this.activeDevice;
    }
}

// Export classes
if (typeof window !== 'undefined') {
    window.Transport = Transport;
    window.BLETransport = BLETransport;
    window.SerialTransport = SerialTransport;
    window.Device = Device;
    window.DeviceRegistry = DeviceRegistry;
}
