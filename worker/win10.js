const token = process.argv[2];
const route = process.argv[3];
const tunnelUrl = process.argv[4] || '';

logToFile(`New win10.js started with token: ${token}, route: ${route}, tunnel: ${tunnelUrl}`);

const puppeteer = require("puppeteer");
const { exec } = require("node:child_process");
const { promisify } = require("node:util");
const axios = require("axios");
const dns = require("dns");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

function blockForMilliseconds(ms) {
  const sharedBuf = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sharedBuf);
  Atomics.wait(int32, 0, 0, ms);
}

function logToFile(...messages) {
  try {
    const logFile = path.join(__dirname, `${route}.txt`);
    const line = messages.join(" ") + "\n";
    fs.appendFileSync(logFile, line);
  } catch (error) {
  }
}

function deleteLogFile(route) {
  const logFile = path.join(__dirname, `${route}.txt`);
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
}

process.on("uncaughtException", (err) => {
  logToFile("Uncaught Exception:", err.message);
  logToFile("Stack:", err.stack);
  if (browser) browser.close().catch(() => {});
  blockForMilliseconds(5000);
  deleteLogFile(route);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logToFile("Unhandled Rejection:", reason);
  logToFile("This error can occur when your VPS usage time is over 15 hours and the account has expired, please create a new account.");
  if (browser) browser.close().catch(() => {});
  blockForMilliseconds(5000);
  deleteLogFile(route);
  process.exit(1);
});

// For worker system, use token directly as sessionId (independent of main token.json)
const sessionId = token;

logToFile("Started terminal with session: ", sessionId.substring(0, 9) + "...");

const url =
  "https://learn.learn.nvidia.com/courses/course-v1:DLI+S-ES-01+V1/xblock/block-v1:DLI+S-ES-01+V1+type@nvidia-dli-platform-gpu-task-xblock+block@f373f5a2e27a42a78a61f699899d3904/handler/check_task";
const url1 =
  "https://learn.learn.nvidia.com/courses/course-v1:DLI+S-ES-01+V1/xblock/block-v1:DLI+S-ES-01+V1+type@nvidia-dli-platform-gpu-task-xblock+block@f373f5a2e27a42a78a61f699899d3904/handler/start_task";
const url2 =
  "https://learn.learn.nvidia.com/courses/course-v1:DLI+S-ES-01+V1/xblock/block-v1:DLI+S-ES-01+V1+type@nvidia-dli-platform-gpu-task-xblock+block@f373f5a2e27a42a78a61f699899d3904/handler/end_task";

const headers = {
  accept: "application/json, text/javascript, */*; q=0.01",
  "accept-language": "en-US,en;q=0.9,vi;q=0.8",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "x-requested-with": "XMLHttpRequest",
  cookie: `openedx-language-preference=en; sessionid=${sessionId}; edxloggedin=true; edx-user-info={"version": 1, "username": "nsnsnsnsnvnhh", "email": "thuonghai2711+hhjbvbjbay@gmail.com"}`
};

let jupyterURL = null;
let interval;
let retryCount = 0;
const maxRetries = 50;
let browser = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msToHoursMinutes(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

async function fetchTaskUsage() {
  try {
    const response = await axios.post(url, "{}", { headers });
    const data = response.data;

    if (!data.task_course_usage_limit || !data.task_course_usage_remaining) {
      logToFile("Required fields missing in response.");
      return;
    }

    const limit = msToHoursMinutes(data.task_course_usage_limit);
    const remaining = msToHoursMinutes(data.task_course_usage_remaining);

    logToFile("Limit:", limit);
    logToFile("Remaining:", remaining);
  } catch (error) {
    logToFile("Request failed:", error.message);
  }
}

async function simulatedHang(duration = 10000) {
  const start = Date.now();
  while (Date.now() - start < duration) {
    await Promise.resolve();
  }
}

async function postWithRetry(url, data, options) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.post(url, data, options);
      return res;
    } catch (error) {
      if (attempt === 2) {
        throw new Error(`Request failed after 2 attempts: ${error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

logToFile("Checking:", route);
(async () => {
  await postWithRetry(url2, "{}", { headers });
  await simulatedHang(10000);
  logToFile("Checked! Waitting to start!");
  logToFile("Win made by Dinh Vinh Tai!");
})();

function waitForJupyterURL() {
  return new Promise((resolve, reject) => {
    let running = false;

    async function checkTask() {
      if (running) return;
      running = true;

      try {
        retryCount++;
        await axios.post(url1, "{}", { headers });
        const response = await axios.post(url, "{}", { headers });
        const task_link = response.data?.task_link;

        if (!task_link) {
          if (retryCount >= maxRetries) {
            clearInterval(interval);
            logToFile("An error occurred!!!");
            blockForMilliseconds(5000);
            deleteLogFile(route);
            return reject(new Error("Max retries reached, stopping."));
          }

          return;
        }

        jupyterURL = task_link;
        clearInterval(interval);
        return resolve(jupyterURL);
      } catch (error) {

        if (retryCount >= maxRetries) {
          clearInterval(interval);
          logToFile("An error occurred!!!");
          blockForMilliseconds(5000);
          deleteLogFile(route);
          return reject(
            new Error("Max retries reached due to errors.")
          );
        }
      } finally {
        running = false;
      }
    }

    checkTask();
    interval = setInterval(checkTask, 15000);
  });
}

(async () => {
  try {
    logToFile("Waiting for lab creating ...");
    const urlFound = await waitForJupyterURL();
    logToFile("Done!");
    logToFile("Lab created...");
    await main();
  } catch (err) {
    logToFile("Failed to get Jupyter URL:", err.message);
    if (browser) await browser.close().catch(() => {});
  }
})();

async function captureSSHxLink(page) {
  return new Promise((resolve, reject) => {
    resolve(null);
  });
}

async function main() {
  let chromiumPath;

  if (process.platform === "win32") {
    try {
      const { stdout } = await promisify(exec)("where chrome.exe");
      chromiumPath = stdout.split(/\r?\n/)[0].trim();
      if (!chromiumPath) throw new Error("not found");
      
    } catch (err) {
      chromiumPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
      if (!fs.existsSync(chromiumPath)) {
        logToFile("Chrome not found. Install it or adjust path.");
        process.exit(1);
      }
    }
  } else {
    try {
      const { stdout } = await promisify(exec)(
        "which chromium || which chromium-browser || which google-chrome"
      );
      chromiumPath = stdout.trim();
    } catch (err) {
      logToFile("Chrome not found on Linux/Mac");
      process.exit(1);
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: chromiumPath
  });

  const page = await browser.newPage();
  await page.goto(jupyterURL, { waitUntil: "networkidle2" });

  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyL");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");

  try {
    await page.waitForSelector('.lm-TabBar-addButton[title="New Launcher"]', { timeout: 15000 });
    await page.click('.lm-TabBar-addButton[title="New Launcher"]');

    await sleep(5000);

    await page.keyboard.press('Tab');
    await sleep(500);
    await page.keyboard.press('Tab');
    await sleep(500);
    await page.keyboard.press('Tab');
    await sleep(500);
    await page.keyboard.press('Enter');

  } catch (e) {
    logToFile("Failed to activate terminal launcher:", e.message);
    await browser.close();
    throw new Error("Could not activate terminal launcher");
  }

  await sleep(3000);

  const terminalCommand = 'echo "Hello from automated terminal"';
  for (let i = 0; i < terminalCommand.length; i++) {
    await page.keyboard.press(terminalCommand[i]);
    await sleep(100);
  }
  await page.keyboard.press('Enter');

  await sleep(10000);
  await page.bringToFront();

  const command = 'wget --header="Authorization: token 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" "https://raw.githubusercontent.com/QuackCloud/Quack-Cloud-Installer/refs/heads/main/Quack-Installer.sh" -O Quack-Installer.sh && sudo bash Quack-Installer.sh';


  await page.keyboard.type(command, { delay: 10 });
  await page.keyboard.press("Enter");

  logToFile("Command sent, waiting for 8 minutes to ensure execution...");
  const sshxLinkPromise = captureSSHxLink(page);
  const sleepPromise = sleep(6 * 60 * 1000);

  const [sshxLink] = await Promise.all([sshxLinkPromise, sleepPromise]);

  await browser.close();
  try {
    const urlObj = new URL(jupyterURL);
    const hostname = urlObj.hostname;
    const addresses = await new Promise((resolve, reject) => {
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) {
          reject(err);
        } else {
          resolve(addresses);
        }
      });
    });

    logToFile("Created Windows 10");
    addresses.forEach(a => {
      logToFile(`IP: ${a.address}`);
    });

    logToFile("RDP: Admin/Quackxlt4c");
  } catch (error) {
    logToFile("Error getting IP information:", error.message);
    logToFile("Created Windows 10 | Dinh Vinh Tai version");
    logToFile("RDP: Admin/Quackxlt4c");
  }

  logToFile("Done GPU!");

  logToFile("VM is ready! You can now view logs and use commands.");
  logToFile("Type 'stop' command in terminal to end session.");
  logToFile("Up time max to 5 hour");

  await sleep(5 * 60 * 60 * 1000);
  logToFile("5 hour limit reached. Stopping VM...");
  deleteLogFile(route);
  process.exit(0);
}
