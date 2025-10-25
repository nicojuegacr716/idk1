const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');

// Worker token file
const WORKER_TOKEN_FILE = 'worker-tokens.json';

const app = express();
let vmCreationLocked = false;


function securityMiddleware(req, res, next) {
  // Removed origin blocking for broader access
  next();
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public'));

function f1(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function performNvidiaLogin(email, password) {
  let browser = null;
  try {
    console.log(`Starting NVIDIA login for ${email}`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-features=UseOzonePlatform",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto('https://learn.learn.nvidia.com/login', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#email', { visible: true, timeout: 10000 });
    await page.type('#email', email);
    await page.click('button[type="submit"]');
    await page.waitForSelector('#signinPassword', { visible: true, timeout: 40000 });
    await page.type('#signinPassword', password);
    await page.click('#passwordLoginButton');

    // NEW: phát hiện sớm trạng thái “chờ xác minh email”
    const EMAIL_WAIT_RX = /nvgs\.nvidia\.com\/v1\/nfactor\/email-auth-wait/i;
    try {
      await Promise.race([
        page.waitForURL(EMAIL_WAIT_RX, { timeout: 8000 }),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }),
      ]);
    } catch (_) {}

    console.log('Waiting for login completion...');
    await new Promise(resolve => setTimeout(resolve, 1 * 30 * 1000));

    let currentUrl = page.url();
    console.log('Current URL after password click:', currentUrl);

    // NEW: nếu đúng trang chờ xác minh email → trả về ngay
    if (EMAIL_WAIT_RX.test(currentUrl)) {
      console.log('Email verification required. Returning early.');
      return { success: false, status: 'need_email_verify', message: 'Yêu cầu xác minh email' };
    }

    if (!currentUrl.includes('/dashboard')) {
      console.log('Not on dashboard, waiting for navigation...');
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        currentUrl = page.url();
        console.log('URL after navigation wait:', currentUrl);
      } catch (navError) {
        console.log('Navigation timeout, checking current URL...');
        currentUrl = page.url();
        console.log('Current URL after timeout:', currentUrl);
      }
    }

    if (!currentUrl.includes('/dashboard')) {
      console.log('Still not on dashboard, direct navigation...');
      await page.goto('https://learn.learn.nvidia.com/dashboard', { waitUntil: 'networkidle2', timeout: 15000 });
    } else {
      console.log('Successfully landed on dashboard');
    }

    await f1(15000);

    const cookies = await page.cookies();
    console.log('All cookies found:', cookies.length);

    const sessionCookie = cookies.find(c => c.name === 'sessionid');
    console.log('Session cookie details:', sessionCookie ? {
      name: sessionCookie.name,
      value: sessionCookie.value.substring(0, 20) + '...',
      domain: sessionCookie.domain,
      expires: sessionCookie.expires
    } : 'none');

    console.log('Session cookie check:', sessionCookie ? 'found' : 'not found');

    if (sessionCookie && sessionCookie.value.length > 10) {
      console.log('Authentication successful - saving token');

      let tokenData = {};
      if (fs.existsSync(WORKER_TOKEN_FILE)) {
        try {
          tokenData = JSON.parse(fs.readFileSync(WORKER_TOKEN_FILE, 'utf8'));
        } catch (e) {
          tokenData = {};
        }
      }

      // For worker tokens, use token as key with slot/inuse and remember email
      tokenData[sessionCookie.value] = {
        slot: 3,
        inuse: false,
        email: (email || '').toLowerCase(),
      };

      fs.writeFileSync(WORKER_TOKEN_FILE, JSON.stringify(tokenData, null, 2));

      console.log(`Token saved successfully for worker system`);
      return { success: true, message: 'Authentication successful', token: sessionCookie.value };
    } else {
      console.log('Authentication failed - no valid session cookie');
      return { success: false, message: 'Authentication failed - no session cookie' };
    }

  } catch (error) {
    console.error(`NVIDIA login error for ${email}:`, error.message);
    return { success: false, message: error.message };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed successfully');
      } catch (closeError) {
        console.log('Error closing browser:', closeError.message);
      }
    }
  }
}

// Login endpoint for worker tokens
app.post('/yud-ranyisi', securityMiddleware, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Validate gmail only, reject dot/plus trick, and disallow googlemail
  try {
    const parts = String(email).trim().toLowerCase().split('@');
    if (parts.length !== 2) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    const [local, domain] = parts;
    if (!local || !domain) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    const allowedDomains = ['gmail.com', 'hotmail.com', 'outlook.com'];

    if (!allowedDomains.includes(domain)) {
      return res.status(400).json({ error: 'domain_not_supported' });
    }

    if (local.includes('.') || local.includes('+')) {
      return res.status(400).json({ error: 'dottrick_not_allowed' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  // Duplicate email check from worker-tokens.json values
  try {
    if (fs.existsSync(WORKER_TOKEN_FILE)) {
      const raw = fs.readFileSync(WORKER_TOKEN_FILE, 'utf8');
      try {
        const tokenData = JSON.parse(raw || '{}');
        const emails = Object.values(tokenData)
          .map(v => (v && typeof v === 'object' ? v.email : null))
          .filter(Boolean);
        if (emails.includes(String(email).toLowerCase())) {
          return res.status(409).json({ error: 'duplicate_mail' });
        }
      } catch (e) {
        // ignore parse error and continue
      }
    }
  } catch (e) {
    // ignore fs error and continue
  }

  console.log('New account login for worker system:', email);

  const result = await performNvidiaLogin(email, password);

  if (result.success) {
    res.json(true);
  } else {
    // NEW: bubble mã riêng “need_email_verify” cho FE xử lý hiển thị
    if (result.status === 'need_email_verify') {
      return res.status(401).json({ error: 'need_email_verify' });
    }
    res.status(401).json({ error: result.message });
  }
});

app.post('/vm-loso', securityMiddleware, async (req, res) => {
  const { action } = req.body;

  if (![1, 2, 3].includes(parseInt(action))) {
    return res.status(400).json({ error: 'Invalid action. Must be 1, 2, or 3' });
  }

  if (vmCreationLocked) {
    return res.status(429).json({ error: 'Server busy, please try again later' });
  }
  vmCreationLocked = true;

  try {
    let tokenData = {};
    if (fs.existsSync(WORKER_TOKEN_FILE)) {
      try {
        tokenData = JSON.parse(fs.readFileSync(WORKER_TOKEN_FILE, 'utf8'));
      } catch (e) {
        return res.status(500).json({ error: 'Invalid worker token file' });
      }
    }

    const availableTokens = Object.keys(tokenData).filter(token =>
      tokenData[token].slot >= 1 && tokenData[token].inuse === false
    );

    if (availableTokens.length === 0) {
      return res.status(400).json({ error: 'No available tokens' });
    }

    const selectedToken = availableTokens[Math.floor(Math.random() * availableTokens.length)];
    tokenData[selectedToken].slot -= 1;
    tokenData[selectedToken].inuse = true;

    const route = 'quack_' + Math.random().toString(36).substring(2, 7);
    fs.writeFileSync(WORKER_TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    let scriptFile;
    switch (parseInt(action)) {
      case 1: scriptFile = 'linux.js'; break;
      case 2: scriptFile = 'win10.js'; break;
      case 3: scriptFile = '2z2.js'; break;
    }

    const { spawn } = require('child_process');
    const vmProcess = spawn('node', [scriptFile, selectedToken, route, tunnelUrl || ''], {
      stdio: 'inherit',
      detached: true,
      cwd: __dirname
    });
    vmProcess.unref();

    console.log(`Started ${scriptFile} with token ${selectedToken} and route ${route}`);
    res.json({ logUrl: `/log/${route}` });
  } catch (error) {
    console.error('Error while creating VM:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  } finally {
    vmCreationLocked = false;
  }
});

let tunnelUrl = null;
let tunnelApp = null;
async function downloadCloudflared() {
  const isWindows = process.platform === 'win32';
  const arch = process.arch; // 'x64', 'arm64', etc.

  // Map kiến trúc → tên asset GitHub
  const assetName = isWindows
    ? (arch === 'arm64' ? 'cloudflared-windows-arm64.exe' : 'cloudflared-windows-amd64.exe')
    : (arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64');

  const fileName = isWindows ? 'cloudflared.exe' : 'cloudflared';
  const filePath = path.join(__dirname, fileName);

  // Cho phép cố định version qua env (VD: CLOUDFLARED_VERSION=2025.9.1)
  const fixedVersion = process.env.CLOUDFLARED_VERSION;

  const axiosInstance = axios.create({
    headers: {
      'User-Agent': 'cloudflared-downloader/1.0 (+node)',
      'Accept': 'application/vnd.github+json'
    },
    maxRedirects: 5,
    timeout: 60_000
  });

  async function resolveDownloadURL() {
    if (fixedVersion) {
      return `https://github.com/cloudflare/cloudflared/releases/download/${fixedVersion}/${assetName}`;
    }
    // Lấy latest qua GitHub API
    const api = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
    const { data } = await axiosInstance.get(api);
    if (!data || !Array.isArray(data.assets)) {
      throw new Error('Cannot resolve latest release assets');
    }
    const asset = data.assets.find(a => a.name === assetName);
    if (!asset || !asset.browser_download_url) {
      // Thử tên amd64 nếu arm64 không có (hiếm, nhưng phòng hờ)
      const fallback = data.assets.find(a => a.name.includes(isWindows ? 'windows-amd64' : 'linux-amd64'));
      if (fallback && fallback.browser_download_url) return fallback.browser_download_url;
      throw new Error(`Asset not found: ${assetName}`);
    }
    return asset.browser_download_url;
  }

  async function streamToFile(url) {
    console.log('Downloading cloudflared from:', url);
    const response = await axiosInstance.get(url, { responseType: 'stream', validateStatus: s => s >= 200 && s < 400 });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      // Axios đã maxRedirects=5, nhưng đề phòng server meta-redirect kỳ cục
      return streamToFile(response.headers.location);
    }
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status} when downloading cloudflared`);
    }

    // Ghi ra file tạm trước rồi rename để tránh 0KB nếu stream hỏng giữa chừng
    const tmpPath = filePath + '.part';
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmpPath);
      response.data.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
      response.data.on('error', reject);
    });

    // Kiểm tra size
    const stat = fs.statSync(tmpPath);
    if (!stat.size || stat.size < 100 * 1024) {
      // <100KB gần như chắc hỏng (binary thật ~10–30MB)
      fs.unlinkSync(tmpPath);
      throw new Error(`Downloaded file too small (${stat.size} bytes)`);
    }

    // Đặt quyền & rename
    if (!isWindows) {
      try { fs.chmodSync(tmpPath, 0o755); } catch (e) { console.log('chmod failed:', e.message); }
    }
    fs.renameSync(tmpPath, filePath);
    return filePath;
  }

  // Thử tải, có fallback nếu fail
  try {
    const url = await resolveDownloadURL();
    const p = await streamToFile(url);
    console.log('Cloudflared downloaded to:', p);
    return p;
  } catch (e) {
    console.log('Primary download failed:', e.message);
    // Fallback: thử "latest" tag trực tiếp theo pattern (ít khi cần)
    try {
      const fallbackUrl = isWindows
        ? `https://github.com/cloudflare/cloudflared/releases/latest/download/${assetName}`
        : `https://github.com/cloudflare/cloudflared/releases/latest/download/${assetName}`;
      const p = await streamToFile(fallbackUrl);
      console.log('Cloudflared downloaded via fallback to:', p);
      return p;
    } catch (e2) {
      console.log('Fallback download failed:', e2.message);
      throw e2;
    }
  }
}


function setupCloudflareTunnel() {
  return new Promise(async (resolve) => {
    const isWindows = process.platform === 'win32';
    const cloudflaredPaths = isWindows
      ? ['cloudflared.exe', './cloudflared.exe', 'C:\\cloudflared\\cloudflared.exe']
      : ['cloudflared', './cloudflared', '/usr/local/bin/cloudflared'];

    let cloudflaredPath = null;

    for (const path of cloudflaredPaths) {
      try {
        await new Promise((resolveCheck, rejectCheck) => {
          exec(`"${path}" --version`, (error, stdout) => {
            if (!error && stdout) {
              cloudflaredPath = path;
              resolveCheck();
            } else {
              rejectCheck();
            }
          });
        });
        break;
      } catch (e) {}
    }

    // Download if not found
    if (!cloudflaredPath) {
      try {
        console.log('Cloudflared not found, downloading...');
        cloudflaredPath = await downloadCloudflared();
        console.log('Cloudflared downloaded to:', cloudflaredPath);
      } catch (error) {
        console.log('Failed to download cloudflared, skipping tunnel setup');
        resolve();
        return;
      }
    }

    console.log('Setting up Cloudflare tunnel...');

    tunnelApp = express();
    tunnelApp.use(bodyParser.json());

    tunnelApp.post('/sshx', (req, res) => {
      const { sshx, route } = req.body;
      if (sshx && route) {
        const logFile = path.join(__dirname, `${route}.txt`);
        fs.appendFileSync(logFile, `SSHx Link: ${sshx}\n`);
        console.log(`SSHx link received for route ${route}: ${sshx}`);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Missing sshx or route' });
      }
    });

    tunnelApp.listen(3001, () => {
      console.log('SSHx receiver server running on port 3001');

      const tunnelProcess = exec(`"${cloudflaredPath}" tunnel --url http://localhost:3001`, (error, stdout, stderr) => {
        console.log('Tunnel process completed');
        if (stdout) {
          console.log('Tunnel stdout:', stdout);
          const urlMatch = stdout.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
          if (urlMatch) {
            tunnelUrl = urlMatch[0];
            console.log('Cloudflare tunnel established:', tunnelUrl);
          }
        }
        if (stderr) {
          console.log('Tunnel stderr:', stderr);
        }
        if (error) {
          console.log('Tunnel error:', error.message);
        }
      });

      tunnelProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Tunnel output:', output);
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
        if (urlMatch && !tunnelUrl) {
          tunnelUrl = urlMatch[0];
          console.log('Cloudflare tunnel established:', tunnelUrl);
        }
      });

      tunnelProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('Tunnel stderr output:', output);
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
        if (urlMatch && !tunnelUrl) {
          tunnelUrl = urlMatch[0];
          console.log('Cloudflare tunnel established:', tunnelUrl);
        }
      });

      setTimeout(() => {
        if (!tunnelUrl) {
          console.log('Warning: Cloudflare tunnel URL not detected, but continuing...');
        }
        resolve();
      }, 10000);
    });
  });
}

// Serve logs - read txt files corresponding to route in worker directory
app.get('/log/:route', (req, res) => {
  const route = req.params.route;
  const logFile = path.join(__dirname, `${route}.txt`);

  if (fs.existsSync(logFile)) {
    const logs = fs.readFileSync(logFile, 'utf8');
    // Ensure proper line breaks for readability (add HTML breaks for web viewing)
    res.send(logs.replace(/\n/g, '<br>\n'));
  } else {
    res.status(404).send('Logs not found');
  }
});

app.get('/health', (req, res) => {
  try {
    const uptimeSeconds = process.uptime();
    const memory = process.memoryUsage();
    let totalSlots = 0;
    let inUse = 0;

    if (fs.existsSync(WORKER_TOKEN_FILE)) {
      const tokenData = JSON.parse(fs.readFileSync(WORKER_TOKEN_FILE, 'utf8'));
      for (const data of Object.values(tokenData)) {
        if (typeof data.slot === 'number' && data.slot > 0) {
          totalSlots += data.slot;
        }
        if (data.inuse) {
          inUse += 1;
        }
      }
    }

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(uptimeSeconds * 100) / 100,
      vmCreationLocked,
      tokens: {
        totalSlots,
        inUse,
      },
      system: {
        platform: os.platform(),
        release: os.release(),
        loadavg: os.loadavg(),
        freeMem: os.freemem(),
        totalMem: os.totalmem(),
        memoryRss: memory.rss,
        nodeVersion: process.version,
      },
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to compute health status',
      details: error.message,
    });
  }
});

app.get('/tokenleft', (req, res) => {
  try {
    if (!fs.existsSync(WORKER_TOKEN_FILE)) {
      return res.json({ totalSlots: 0 });
    }

    const tokenData = JSON.parse(fs.readFileSync(WORKER_TOKEN_FILE, 'utf8'));
    let totalSlots = 0;

    for (const [token, data] of Object.entries(tokenData)) {
      if (typeof data.slot === 'number' && data.slot > 0) {
        totalSlots += data.slot;
      }
    }

    res.json({ totalSlots });
  } catch (err) {
    console.error('Error reading token slots:', err.message);
    res.status(500).json({ error: 'Failed to calculate token slots' });
  }
});


// Stop VM endpoint - send end_task to NVIDIA and reset token inuse status
app.post('/stop/:route', securityMiddleware, async (req, res) => {
  const route = req.params.route;

  try {
    // Find the token associated with this route
    let tokenData = {};
    if (fs.existsSync(WORKER_TOKEN_FILE)) {
      tokenData = JSON.parse(fs.readFileSync(WORKER_TOKEN_FILE, 'utf8'));
    }

    // Find which token is currently in use for this route
    // Note: In a production system, we'd maintain a route-token mapping
    let usedToken = null;
    for (const [token, data] of Object.entries(tokenData)) {
      if (data.inuse) {
        usedToken = token;
        break; // Assuming only one token is in use at a time per route
      }
    }

    if (!usedToken) {
      return res.status(400).json({ error: 'No active token found for this route' });
    }

    // Send end_task request to NVIDIA API
    const headers = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.9,vi;q=0.8",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      cookie: `openedx-language-preference=en; sessionid=${usedToken}; edxloggedin=true; edx-user-info={"version": 1, "username": "nsnsnsnsnvnhh", "email": "thuonghai2711+hhjbvbjbay@gmail.com"}`
    };

    await axios.post('https://learn.learn.nvidia.com/courses/course-v1:DLI+S-ES-01+V1/xblock/block-v1:DLI+S-ES-01+V1+type@nvidia-dli-platform-gpu-task-xblock+block@f373f5a2e27a42a78a61f699899d3904/handler/end_task', "{}", { headers });

    console.log(`End task request sent for route ${route} with token ${usedToken}`);

    // Kill the VM process
    const { exec } = require('child_process');
    exec(`powershell -Command "Get-Process | Where-Object { $_.ProcessName -eq 'node' -and $_.CommandLine -like '*${route}*' } | Stop-Process -Force"`, (error, stdout, stderr) => {
      if (error) {
        console.log('PowerShell process kill result:', error.message);
        // Fallback: try to kill all node processes except the server
        exec(`taskkill /f /im node.exe /fi "PID ne ${process.pid}"`, (fallbackError) => {
          if (fallbackError) {
            console.log('Fallback process kill also failed:', fallbackError.message);
          }
        });
      } else {
        console.log('Successfully killed VM process for route:', route);
      }
    });

    // Reset token inuse status
    tokenData[usedToken].inuse = false;
    fs.writeFileSync(WORKER_TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    // Add log entry about stopping
    const logFile = path.join(__dirname, `${route}.txt`);
    const logEntry = `\n=== VM STOPPED AT ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })} (GMT+7) ===\n`;
    fs.appendFileSync(logFile, logEntry);

    res.json({
      success: true,
      message: `VM stopped successfully for route ${route}`,
      tokenReset: usedToken
    });

  } catch (error) {
    console.error('Error stopping VM:', error.message);
    res.status(500).json({ error: 'Failed to stop VM', details: error.message });
  }
});

// Periodic token cleanup - run every 20 minutes
setInterval(() => {
  try {
    let tokenData = {};
    if (fs.existsSync(WORKER_TOKEN_FILE)) {
      tokenData = JSON.parse(fs.readFileSync(WORKER_TOKEN_FILE, 'utf8'));
    }

    const tokensToRemove = [];
    for (const [token, data] of Object.entries(tokenData)) {
      if (data.slot === 0) {
        tokensToRemove.push(token);
      }
    }

    if (tokensToRemove.length > 0) {
      tokensToRemove.forEach(token => delete tokenData[token]);
      fs.writeFileSync(WORKER_TOKEN_FILE, JSON.stringify(tokenData, null, 2));
      console.log(`Worker server: Cleaned up ${tokensToRemove.length} expired tokens`);
    }
  } catch (error) {
    console.error('Error during token cleanup:', error.message);
  }
}, 20 * 60 * 1000); // 20 minutes

app.listen(4000, async () => {
  console.log('Worker server running on port 4000');
  console.log('Endpoints:');
  console.log('  POST /yud-ranyisi - Login and add worker token');
  console.log('  POST /vm-loso - Create VM (1=linux, 2=windows, 3=trash)');
  console.log('  POST /stop/:route - Stop VM by route');
  console.log('  GET /health - Worker health status');
  console.log('  GET /log/:route - Get VM logs');
  console.log('  GET /tokenleft - Remaining token slots');

  // Setup Cloudflare tunnel for SSHx link receiving
  await setupCloudflareTunnel();
});
