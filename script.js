let memory;             // For accessing WASM memory buffer
let get_g_input_buffer; // The specific C function to get the input pointer
let init_system;        // C function to initialize the C backend
const Module = {};      // The object for mapping C exports
let batteryManager = null;

// UI References
const terminalOutputDiv = document.getElementById('terminal-output');
const terminalInput = document.getElementById('terminal-input');
const promptSpan = document.getElementById('prompt');
// Reference to the specific PRE tag in the top-right panel
const neofetchPre = document.getElementById('neofetch-output');

// Terminal State (For the main interactive terminal)
const commandHistory = [];
let historyIndex = -1;
let currentPath = "/";


const memoryPanel = document.getElementById('status-panel-2'); // 3rd panel


const loadingScreen = document.getElementById('loading-screen');
const loadingStatus = document.getElementById('loading-status');


// WASM MEMORY UTILS

const utf8Decoder = new TextDecoder('utf-8');
function readStringFromMemory(ptr) {
    const memoryView = new Uint8Array(memory.buffer);
    
    let end = ptr;
    while (memoryView[end] !== 0) {
        end++;
    }
    const bytes = memoryView.subarray(ptr, end);
    return utf8Decoder.decode(bytes);
}
function writeStringToMemory(str) {
    const ptr = get_g_input_buffer();
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str + "\0");
    const memoryView = new Uint8Array(memory.buffer);
    memoryView.set(bytes, ptr);
    return ptr;
}

function parseTerminalText(str){
    // Syntax: \u001b[L<id>m  to START
    // Syntax: \u001b[Lem     to END
    let safeStr = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const linkMap = {
        'gh': 'https://github.com/billie-bytes',
        'ln': 'https://github.com/billie-linkedin.com/in/billie-bhaskara-wibawa-288a81345',
        'ml': 'mailto:billiebaskarawibawa101@gmail.com'
    }

    safeStr = safeStr.replace(/\u001b\[Lem/g, '</a>');
    safeStr = safeStr.replace(/\u001b\[L(.+?)m/g, (match, id) => {
        const url = linkMap[id];
        if (url) {
            return `<a href="${url}" target="_blank" class="terminal-link">`;
        }
        return ''; // If ID not found, remove the tag but print the text
    });
    
    return parseAnsiColors(safeStr);

}

// COLOR PARSER
function parseAnsiColors(str) {
    const colorMap = {
        '31': '#ff5555', 
        '32': '#50fa7b', 
        '33': '#f1fa8c', 
        '34': '#97b1f1', 
        '35': '#ffffffff',
        '36': '#be94f9ff', 
        '90': '#6272a4',
        '0':  'RESET'
    };

    return str.replace(/\u001b\[(\d+)m/g, (match, code) => {
        if (code === '0') {
            return '</span>';
        }
        
        const hex = colorMap[code];
        if (hex) {
            return `</span><span style="color: ${hex}">`;
        }
        
        return '';
    });
}

// SYSTEM STATS UPDATING

function waitForBackground() {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = 'background.webp';
        
        if (img.complete) {
            resolve();
        } else {
            img.onload = resolve;
            img.onerror = resolve;
        }
    });
}

function updateUptime() {
    const uptimeMilliseconds = performance.now();
    const uptimeSeconds = Math.floor(uptimeMilliseconds / 1000);
    let ptr = writeStringToMemory(formatUptime(uptimeSeconds));
    Module._set_uptime(ptr);
}

function formatUptime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

async function initBattery() {
    if (navigator.getBattery) {
        batteryManager = await navigator.getBattery();
        batteryManager.addEventListener('levelchange', updateBatteryStats);
    }
}

function updateBatteryStats() {
    if (batteryManager) {
        Module._set_system_battery(Math.floor(batteryManager.level * 100));
    }
}

function updateFrequentStats(){
    if(window.performance && window.performance.memory){
        Module._set_memory_usage(performance.memory.usedJSHeapSize);
    }
}

function updateOnceStats(){
    Module._set_window_width(window.screen.width);
    Module._set_window_height(window.screen.height);
    if(navigator.hardwareConcurrency) Module._set_system_cores(navigator.hardwareConcurrency);
    if(navigator.deviceMemory) Module._set_system_ram(navigator.deviceMemory);
    writeStringToMemory(navigator.language.substring(0, 31));
}


// ANIMATION LOOP

/**
 * @brief Continuously fetches frame from C and renders to the Top-Right panel
 */
function renderNeofetchLoop() {
    const outputPtr = Module._get_frame();
    const outputString = readStringFromMemory(outputPtr);
    // Parse colors and set innerHTML of the top-right PRE tag
    neofetchPre.innerHTML = parseTerminalText(outputString);
}

function renderHexDump() {
    const startOffset = get_hexdump_ptr(); 
    const panelHeight = memoryPanel.clientHeight;
    const rowHeight = 12; 
    const availableRows = Math.floor((panelHeight - 30) / rowHeight);
    const length = Math.max(16, availableRows * 16); 

    const memoryView = new Uint8Array(memory.buffer);
    
    let html = '<div class="hex-grid" style="font-family: monospace; font-size: 10px; line-height: 1.15;">';
    html += '<div style="color: #888; margin-bottom: 5px; font-weight:bold;">LIVE MEMORY DUMP</div>';
    
    for (let i = 0; i < length; i += 16) {
        let rowHtml = `<span style="color: #555">0x${(startOffset + i).toString(16).padStart(4, '0').toUpperCase()}: </span>`;
        
        let hexPart = '';
        let asciiPart = '';

        for (let j = 0; j < 16; j++) {
            // Safety check: Don't read past the end of memory
            if (startOffset + i + j >= memoryView.length) break;

            const byte = memoryView[startOffset + i + j];
            
            // Hex Coloring
            let color = '#97b1f1'; 
            if (byte === 0) color = '#333'; 
            else if (byte > 32 && byte < 127) color = '#fff'; 
            
            hexPart += `<span style="color: ${color}">${byte.toString(16).padStart(2, '0').toUpperCase()}</span> `;
            
            // ASCII Representation
            if (byte >= 32 && byte <= 126) {
                asciiPart += String.fromCharCode(byte);
            } else {
                asciiPart += '.';
            }
        }
        
        rowHtml += `<span style="margin-right: 10px">${hexPart}</span>`;
        rowHtml += `<span style="color: #aaa; border-left: 1px solid #444; padding-left: 5px;">${asciiPart}</span>`;
        rowHtml += '<br>';
        html += rowHtml;
    }
    
    html += '</div>';
    memoryPanel.innerHTML = html;
}

function renderClock() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    
    const h = pad(now.getHours());
    const m = pad(now.getMinutes());
    const s = pad(now.getSeconds());
    const html = `
        <div>${h}</div>
        <div>${m}</div>
        <div>${s}</div>
    `;

    const clockEl = document.getElementById('digital-clock-vertical');
    if (clockEl) clockEl.innerHTML = html;
}

function waitForClock() {
    return new Promise((resolve) => {
        const check = () => {
            const clockEl = document.getElementById('digital-clock-vertical');
            if (clockEl && clockEl.innerHTML.trim().length > 0 && clockEl.clientHeight > 0) {
                resolve();
            } else {
                // Not ready yet, check again in the next animation frame
                requestAnimationFrame(check);
            }
        };
        check();
    });
}


// MAIN INTERACTIVE TERMINAL LOGIC

function updateInputPrompt() {
    // Updates the visual prompt next to the input box
    promptSpan.innerHTML = `billie-bytes@portfolio:<span style="color: #bd93f9">${currentPath}</span>$`;
}

function scrollToBottom() {
    const terminalMain = document.getElementById('terminal-output');
    if (!terminalMain) return;
    setTimeout(() => {
        terminalMain.scrollTop = terminalMain.scrollHeight;
    }, 0);
}


function appendToTerminal(text, isCommand = false) {
    const div = document.createElement('div');
    if (isCommand) {
         // billie-bytes@portfolio:path$
         div.innerHTML = `
<span class="prompt">billie-bytes@portfolio:<span style="color: #be94f9ff">${currentPath}</span>$</span> <span style="color: #ffffffff">${text}</span>`;
    } else {
         div.textContent = text; 
    }
    terminalOutputDiv.appendChild(div);
    scrollToBottom();
}

async function handleCommand(cmd) {
    const trimmedCmd = cmd.trim();
    if (trimmedCmd.length === 0) return;

    appendToTerminal(trimmedCmd, true);
    commandHistory.push(trimmedCmd);
    historyIndex = commandHistory.length;

    if (Module._exec_cmd) {
        writeStringToMemory(trimmedCmd);
        Module._exec_cmd();
        const outputPtr = get_g_output_buffer();
        const outputStr = readStringFromMemory(outputPtr);

        const isCd = trimmedCmd === 'cd' || trimmedCmd.startsWith('cd ');



        if(outputStr.length > 0) {
            if(isCd && outputStr.trim().startsWith('/')){
                currentPath = outputStr.trim();
                updateInputPrompt();
            }
            else{
                // Using innerHTML here allows the C backend to send <br> or ANSI later
                const outDiv = document.createElement('div');
                let formatted = parseTerminalText(outputStr);
                formatted = formatted.replace(/\n/g, '<br>');
                // For now, just handle newlines. Later apply parseAnsiColors here.
                outDiv.innerHTML = formatted;
                terminalOutputDiv.appendChild(outDiv);
            }

        }
    } else {
        appendToTerminal(`Error: Kernel not loaded or exec_cmd missing.`);
    }
    scrollToBottom();
}


terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cmd = terminalInput.value;
        handleCommand(cmd);
        terminalInput.value = '';
    }

    else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            terminalInput.value = commandHistory[historyIndex];
        }
    }
    else if (e.key === 'ArrowDown') {
         e.preventDefault();
         if (historyIndex < commandHistory.length - 1) {
             historyIndex++;
             terminalInput.value = commandHistory[historyIndex];
         } else {
             historyIndex = commandHistory.length;
             terminalInput.value = '';
         }
    }
});


document.getElementById('terminal-main').addEventListener('click', () => {
    terminalInput.focus();
});


async function boot() {
    try {
        loadingStatus.textContent = "LOADING KERNEL.WASM...";
        const wasmPromise = fetch('kernel.wasm?t=' + new Date().getTime());
        const bgPromise = waitForBackground();


        const response = await wasmPromise;
        const buffer = await response.arrayBuffer();


        const imports = {
            env: {
                clear: () =>{
                    terminalOutputDiv.innerHTML = '';
                }
            }
        };

        loadingStatus.textContent = "INSTANTIATING MODULE...";
        const { instance } = await WebAssembly.instantiate(buffer, imports);
        const exports = instance.exports;
        

        memory = exports.memory;
        init_system = exports.init_system;
        get_g_input_buffer = exports.get_g_input_buffer;
        get_g_output_buffer = exports.get_g_output_buffer;
        get_hexdump_ptr = exports.get_hexdump_ptr;


        Module._set_window_width = exports.set_window_width;
        Module._set_window_height = exports.set_window_height;
        Module._set_terminal = exports.set_terminal;
        Module._set_system_cores = exports.set_system_cores;
        Module._set_system_ram = exports.set_system_ram;
        Module._set_memory_usage = exports.set_memory_usage;
        Module._set_system_battery = exports.set_system_battery;
        Module._get_frame = exports.get_frame;
        Module._set_uptime = exports.set_uptime;
        Module._kernel_tick = exports.kernel_tick;
        

        Module._exec_cmd = exports.exec_cmd;
        loadingStatus.textContent = "LOADING ASSETS...";
        await bgPromise;

        // Initialize System Data
        init_system();
        updateOnceStats(); 
        await initBattery();
        updateBatteryStats();

        // Background loop
        setInterval(updateFrequentStats, 1000);
        setInterval(updateBatteryStats, 10000);

        
        // Foreground loop
        setInterval(() => {

            /*This section is for kernel tick but for now it appends
            text to terminal like any other command (which is wrong
            for animations as it will push stuff below)*/
            Module._kernel_tick();
            const outputPtr = get_g_output_buffer();
            const outputStr = readStringFromMemory(outputPtr);
            if(outputStr.length > 0) {
                // Using innerHTML here allows the C backend to send <br> or ANSI later
                const outDiv = document.createElement('div');
                let formatted = parseTerminalText(outputStr);
                formatted = formatted.replace(/\n/g, '<br>');
                // For now, just handle newlines. Later apply parseAnsiColors here.
                outDiv.innerHTML = formatted;
                terminalOutputDiv.appendChild(outDiv);
                scrollToBottom();
            }
            
            renderNeofetchLoop();
            renderHexDump();
        }, 50);
        setInterval(renderClock, 1000);
        setInterval(updateUptime, 1000);
        
        await waitForClock();

        
        loadingStatus.textContent = "BOOT COMPLETE.";
        setTimeout(() => {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }, 500);

        handleCommand("cat intro.txt");
    } catch (err) {
        console.error("Boot failed:", err);
        appendToTerminal("CRITICAL ERROR: Could not load kernel.wasm");
    }
}



boot();