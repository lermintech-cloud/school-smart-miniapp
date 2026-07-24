/**
 * ============================================================================
 * 🏫 SCHOOL SMART ASSISTANT BOT (World-Class Version)
 * ============================================================================
 */

// ⚙️ 1. CONFIGURATION (ศูนย์รวมการตั้งค่าทั้งหมด ปรับแก้ที่นี่จุดเดียว)
const CONFIG = {
  TELEGRAM: {
    // ⚠️ คำเตือน: อย่าลืมไป Revoke Token ที่ @BotFather หลังทดสอบเสร็จ!
    TOKEN: '8337776449:AAE1CYOnZfDzwI2UZM1Pt0NIWJEniN8JcSs',
    DEFAULT_CHAT_ID: '-1004431141224'
  },
  LOCATION: {
    NAME: 'อ.ดอยเต่า',
    LAT: '17.9525',
    LON: '98.6853',
    TIMEZONE: 'Asia/Bangkok' // 🕒 โซนเวลาสำหรับใช้คำนวณวันพรุ่งนี้/วันนี้ให้ถูกต้องตามเวลาไทย
  },
  WEATHER: {
    // 🔑 ใส่ API Key ของ WeatherAPI.com ที่นี่ (แนะนำอย่างยิ่งสำหรับป้องกันปัญหา IP Block ช่วงเวลาทิกเกอร์รัน)
    // วิธีรับคีย์ฟรี: สมัครสมาชิกที่ https://www.weatherapi.com/ แล้วนำ API Key มาวางในฟันหนูนี้
    API_KEY: '3319fa2496ba4c9c862124743260907' 
  },
  SHEETS: {
    DUTY: 'DUTY',
    UNIFORM: 'UNIFORM',
    CALENDAR: 'CALENDAR',
    TEACHERS: 'TEACHERS'
  },
  CACHE_TIME_SEC: 3600, // แคชข้อมูล 1 ชั่วโมง
  MAX_RETRIES: 3
};

// ============================================================================
// 🚀 2. CORE SERVICES (ระบบหลัก: ส่งข้อความ, ดึงข้อมูล API)
// ============================================================================

/**
 * ส่งข้อความไปยัง Telegram
 */
function sendTelegramMessage(text, chatId = CONFIG.TELEGRAM.DEFAULT_CHAT_ID) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      Logger.log(`[Telegram Error] ${response.getResponseCode()}: ${response.getContentText()}`);
    }
  } catch (error) {
    Logger.log(`[Telegram Exception] ${error.message}`);
  }
}

/**
 * ดึงข้อมูลพยากรณ์อากาศ Open-Meteo / WeatherAPI
 */
function getWeatherForecast(targetDate) {
  const tz = CONFIG.LOCATION.TIMEZONE || Session.getScriptTimeZone();
  const dateStr = Utilities.formatDate(targetDate, tz, "yyyyMMdd");
  const isTomorrow = dateStr !== Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  const timeLabel = isTomorrow ? "พรุ่งนี้" : "วันนี้";
  const cacheKey = `weather_${dateStr}`;
  const cache = CacheService.getScriptCache();
  
  if (cache.get(cacheKey)) return cache.get(cacheKey);

  const hasApiKey = CONFIG.WEATHER && CONFIG.WEATHER.API_KEY && CONFIG.WEATHER.API_KEY.trim() !== '';
  
  let url = '';
  if (hasApiKey) {
    url = `https://api.weatherapi.com/v1/forecast.json?key=${CONFIG.WEATHER.API_KEY.trim()}&q=${CONFIG.LOCATION.LAT},${CONFIG.LOCATION.LON}&days=2&aqi=no&alerts=no&lang=th`;
  } else {
    url = `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.LOCATION.LAT}&longitude=${CONFIG.LOCATION.LON}&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Asia%2FBangkok`;
  }

  // วนลูปสูงสุด 8 ครั้ง (ครั้งละ 30 วินาที = รวมประมาณ 4 นาที)
  const maxAttempts = 8;
  let lastErrorMsg = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const code = response.getResponseCode();

      if (code !== 200) {
        lastErrorMsg = `HTTP ${code}: ${response.getContentText()}`;
        Logger.log(`[Weather Forecast] Attempt ${attempt} failed: ${lastErrorMsg}`);
        
        if (attempt < maxAttempts) {
          Utilities.sleep(30000); // ดีเลย์รอ 30 วินาที
          continue;
        }
        break;
      }

      const json = JSON.parse(response.getContentText());
      let temp, rainProb, weatherText, icon;

      if (hasApiKey) {
        // --- กรณีใช้ WeatherAPI.com ---
        if (!json?.forecast?.forecastday) {
          lastErrorMsg = "Invalid WeatherAPI JSON structure";
          if (attempt < maxAttempts) { Utilities.sleep(30000); continue; }
          break;
        }
        const index = isTomorrow ? 1 : 0;
        const fDay = json.forecast.forecastday[index];
        if (!fDay) {
          break;
        }
        temp = Math.round(fDay.day.maxtemp_c);
        rainProb = fDay.day.daily_chance_of_rain || 0;
        
        const conditionCode = Number(fDay.day.condition.code);
        const weatherInfo = getWeatherApiConditionTH(conditionCode);
        icon = weatherInfo.icon;
        weatherText = weatherInfo.text;

      } else {
        // --- กรณีใช้ Open-Meteo ---
        if (!json?.daily) {
          lastErrorMsg = "Invalid Open-Meteo JSON structure";
          if (attempt < maxAttempts) { Utilities.sleep(30000); continue; }
          break;
        }

        const wCodes = json.daily.weather_code || json.daily.weathercode;
        const temps = json.daily.temperature_2m_max;
        const rainProbs = json.daily.precipitation_probability_max || [];

        const index = isTomorrow ? 1 : 0;
        if (!wCodes || !temps || index >= temps.length) {
          break;
        }

        temp = Math.round(temps[index]);
        const weatherCode = Number(wCodes[index]);
        rainProb = (rainProbs.length > index && rainProbs[index] !== null) ? Number(rainProbs[index]) : 0;

        const weatherCondition = getWeatherCondition(weatherCode);
        icon = weatherCondition.icon;
        weatherText = weatherCondition.text;
      }

      let advice = "";
      if (rainProb >= 80) advice = " (ควรพกร่ม ☔)";
      else if (rainProb >= 50) advice = " (มีโอกาสเกิดฝน)";
      if (temp >= 37) advice += " 🥵 อากาศร้อนจัด";

      // อัปเดตรูปแบบข้อความพยากรณ์อากาศให้เป็นภาษาไทยตามที่ต้องการ
      const result = `🌦️ <b>สภาพอากาศ ${CONFIG.LOCATION.NAME} (${timeLabel}):</b>\n🌡️ <b>อุณหภูมิ:</b> ${icon} ${weatherText} | ${temp}°C\n🌧️ <b>โอกาสฝน:</b> ${rainProb}%${advice}`;
      
      cache.put(cacheKey, result, CONFIG.CACHE_TIME_SEC);
      return result;

    } catch (e) {
      lastErrorMsg = e.message;
      if (attempt < maxAttempts) {
        Utilities.sleep(30000);
        continue;
      }
    }
  }
  
  return `🌦️ <b>สภาพอากาศ ${CONFIG.LOCATION.NAME} (${timeLabel}):</b> ⚠️ ไม่สามารถเชื่อมต่อบริการพยากรณ์อากาศได้`;
}

// ฟังก์ชันแปลรหัสสภาพอากาศ WeatherAPI เป็นภาษาไทย
function getWeatherApiConditionTH(code) {
  const conditions = {
    1000: { icon: "☀️", text: "ท้องฟ้าแจ่มใส" },
    1003: { icon: "⛅", text: "มีเมฆบางส่วน" },
    1006: { icon: "☁️", text: "มีเมฆมาก" },
    1009: { icon: "☁️", text: "มืดครึ้ม" },
    1030: { icon: "🌫️", text: "มีหมอก" },
    1063: { icon: "🌦️", text: "ฝนตกประปรายบางพื้นที่" },
    1087: { icon: "⛈️", text: "อาจมีพายุฝนฟ้าคะนอง" },
    1135: { icon: "🌫️", text: "หมอกลงจัด" },
    1150: { icon: "🌦️", text: "ฝนละอองเบาบาง" },
    1153: { icon: "🌦️", text: "ฝนละออง" },
    1180: { icon: "🌦️", text: "ฝนตกเบาบางบางพื้นที่" },
    1183: { icon: "🌦️", text: "ฝนตกเบาบาง" },
    1186: { icon: "🌧️", text: "ฝนตกปานกลางบางพื้นที่" },
    1189: { icon: "🌧️", text: "ฝนตกปานกลาง" },
    1192: { icon: "🌧️", text: "ฝนตกหนักบางพื้นที่" },
    1195: { icon: "🌧️", text: "ฝนตกหนัก" },
    1240: { icon: "🌦️", text: "ฝนตกปรอยๆ" },
    1243: { icon: "🌧️", text: "ฝนตกหนักเป็นหย่อมๆ" },
    1246: { icon: "🌧️", text: "ฝนตกหนักมาก" },
    1273: { icon: "⛈️", text: "ฝนตกเบาบางพร้อมพายุฟ้าคะนอง" },
    1276: { icon: "⛈️", text: "ฝนตกหนักพร้อมพายุฟ้าคะนอง" }
  };
  return conditions[code] || { icon: "🌤️", text: "สภาพอากาศปกติ" };
}

// ฟังก์ชันแปลรหัสสภาพอากาศ Open-Meteo (เผื่อกรณี API Key มีปัญหา)
function getWeatherCondition(code) {
  if (code === 0) return { icon: "☀️", text: "ท้องฟ้าแจ่มใส" };
  if (code >= 1 && code <= 3) return { icon: "⛅", text: "มีเมฆบางส่วน" };
  if (code >= 45 && code <= 48) return { icon: "🌫️", text: "มีหมอก" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", text: "ฝนตกปรอยๆ" };
  if (code >= 61 && code <= 67) return { icon: "🌧️", text: "ฝนตก" };
  if (code >= 71 && code <= 77) return { icon: "❄️", text: "หิมะตก" };
  if (code >= 80 && code <= 82) return { icon: "🌧️", text: "ฝนตกหนัก" };
  if (code >= 95) return { icon: "⛈️", text: "พายุฝนฟ้าคะนอง" };
  return { icon: "🌤️", text: "สภาพอากาศปกติ" };
}

/**
 * ดึงข้อมูลฝุ่น PM 2.5
 */
function getPM25() {
  const tz = CONFIG.LOCATION.TIMEZONE || Session.getScriptTimeZone();
  const cacheKey = `pm25_${Utilities.formatDate(new Date(), tz, "yyyyMMddHH")}`;
  const cache = CacheService.getScriptCache();
  if (cache.get(cacheKey)) return cache.get(cacheKey);

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${CONFIG.LOCATION.LAT}&longitude=${CONFIG.LOCATION.LON}&current=pm2_5&timezone=Asia%2FBangkok`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = response.getResponseCode();
    if (code === 200) {
      const json = JSON.parse(response.getContentText());
      if (json?.current?.pm2_5 != null) {
        const pm25 = Math.round(json.current.pm2_5);
        let icon = "", advice = " อากาศดีมาก"; // ซ่อนจุดสีเขียวตามต้องการ หรือใส่ไอคอนที่ชอบได้

        if (pm25 > 75) { icon = "🔴 "; advice = " (อันตราย! งดกิจกรรมกลางแจ้ง/สวมหน้ากาก)"; }
        else if (pm25 > 37.5) { icon = "🟠 "; advice = " (เริ่มมีผลต่อสุขภาพ เลี่ยงกิจกรรมกลางแจ้ง)"; }

        // อัปเดตรูปแบบข้อความฝุ่น PM 2.5 ให้ตรงตามต้องการ
        const result = `😷 <b>ค่าฝุ่น:</b> ${icon}${pm25} µg/m³${advice}`;
        cache.put(cacheKey, result, CONFIG.CACHE_TIME_SEC);
        return result;
      }
    }
  } catch (e) {
    Logger.log(`[PM2.5 Exception] ${e.message}`);
  }
  return "";
}

function getRandomQuote() {
  const quotes = [
    "“ครูคือผู้จุดประทีปทางปัญญาให้กับศิษย์” 🕯️",
    "“การศึกษาไม่ใช่การเตรียมตัวสำหรับชีวิต มันคือชีวิตในตัวมันเอง” - John Dewey",
    "“ครูที่ดีไม่ใช่แค่ผู้สอน แต่คือผู้สร้างแรงบันดาลใจให้กับเด็กๆ” 🌟",
    "“ความสำเร็จไม่ได้มาจากการรอคอย แต่มาจากการลงมือทำทีละนิดในทุกวัน” 💪",
    "“หนทางหมื่นลี้ เริ่มต้นที่ก้าวแรกเสมอ ขอให้เป็นวันที่ดีครับคุณครู” 👣"
  ];
  return `\n💡 <i>${quotes[Math.floor(Math.random() * quotes.length)]}</i>`;
}

// ============================================================================
// 📊 3. DATA PROCESSING (ประมวลผลข้อมูลจาก Google Sheets)
// ============================================================================

/**
 * ฟังก์ชันช่วยดึงข้อมูลจาก Sheet ลดการเขียนโค้ดซ้ำ
 */
function getSheetData(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  return sheet ? sheet.getDataRange().getValues() : [];
}

function generateDailyReport() {
  const now = new Date();
  const tz = CONFIG.LOCATION.TIMEZONE || Session.getScriptTimeZone();
  const targetDate = new Date();
  
  // คำนวณเวลาชั่วโมงอ้างอิงจากโซนเวลาที่ตั้งค่าไว้
  const currentHour = parseInt(Utilities.formatDate(now, tz, "H"), 10);
  const isMorning = currentHour < 12;
  if (!isMorning) targetDate.setDate(targetDate.getDate() + 1);

  const dateStr = Utilities.formatDate(targetDate, tz, "yyyy-MM-dd");
  const displayDate = Utilities.formatDate(targetDate, tz, "dd/MM/yyyy");
  const dayNames = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const dayName = dayNames[targetDate.getDay()];
  const targetMonth = targetDate.getMonth();

  const title = isMorning ? "🔔 <b>แจ้งเตือนประจำวันนี้</b>" : "🔔 <b>แจ้งเตือนประจำวันพรุ่งนี้</b>";

  // --- 1. ดึงข้อมูลเวรครู ---
  let dutyInfo = "ไม่ระบุ";
  const dutyData = getSheetData(CONFIG.SHEETS.DUTY);
  const dutyRow = dutyData.find((row, index) => index > 0 && row[0] === dayName);
  if (dutyRow) dutyInfo = `${dutyRow[1]} และ ${dutyRow[2]}`;

  // --- 2. ดึงข้อมูลการแต่งกาย ---
  let uniformInfo = "ชุดนักเรียน";
  const uniformData = getSheetData(CONFIG.SHEETS.UNIFORM);
  const uniformRow = uniformData.find((row, index) => index > 0 && row[0] === dayName);
  if (uniformRow) uniformInfo = uniformRow[1];

  
  // --- 3. ดึงข้อมูลปฏิทินกิจกรรม ---
  let eventInfo = "";
  const calData = getSheetData(CONFIG.SHEETS.CALENDAR);
  
  // เปลี่ยนมาใช้ .filter() เพื่อดึงกิจกรรมทั้งหมดในวันนั้น
  const eventRows = calData.filter((row, index) => {
    if (index === 0 || !row[0]) return false;
    try {
      return Utilities.formatDate(new Date(row[0]), tz, "yyyy-MM-dd") === dateStr;
    } catch (e) { return false; }
  });

  if (eventRows.length > 0) {
    if (eventRows.length === 1) {
      // กรณีมีกิจกรรมเดียว
      eventInfo = `🗓️ <b>กิจกรรม:</b> ${eventRows[0][1]}`;
    } else {
      // กรณีมีหลายกิจกรรม ให้จัดเรียงเป็นข้อๆ
      const eventsList = eventRows.map(row => `▫️ ${row[1]}`).join("\n");
      eventInfo = `🗓️ <b>กิจกรรม (${eventRows.length} รายการ):</b>\n${eventsList}`;
    }
  }
  // --- 4. ดึงข้อมูลวันเกิด ---
  const teachData = getSheetData(CONFIG.SHEETS.TEACHERS);
  const monthNames = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const bdayList = teachData.reduce((acc, row, index) => {
    if (index === 0 || !row[1]) return acc;
    let bMonth = -1;
    if (row[1] instanceof Date) bMonth = row[1].getMonth();
    else {
      const parts = String(row[1]).split('/');
      if (parts.length >= 2) bMonth = parseInt(parts[1], 10) - 1;
    }
    if (bMonth === targetMonth) acc.push(row[0]);
    return acc;
  }, []);
  
  const bdayInfo = bdayList.length > 0 ? `🎂 <b>วันเกิดครูเดือนนี้ (${monthNames[targetMonth]}):</b> ${bdayList.join(", ")}` : "";

  // --- 5. ประกอบร่างข้อความ (Message Builder) ---
  const messageParts = [
    `${title} (วัน${dayName})`,
    `📅 <b>วันที่:</b> ${displayDate}\n`,
    getWeatherForecast(targetDate),
    getPM25(),
    `\n👕 <b>การแต่งกาย:</b> ${uniformInfo}`,
    `👮 <b>เวรครู:</b> ${dutyInfo}`,
    eventInfo,
    bdayInfo,
    getRandomQuote(),
    `\n<i>School Smart Assistant</i>`
  ];

  // กรองบรรทัดที่ว่างเปล่าทิ้ง และเชื่อมด้วยการเว้นบรรทัด
  return messageParts.filter(part => part !== "").join('\n');
}
// --- แก้ไขฟังก์ชัน doGet เดิมให้รองรับการเปิดหน้าเว็บ HTML ---
function doGet(e) {
  const action = e?.parameter?.action || "web"; // ตั้งค่าเริ่มต้นให้เปิดหน้าเว็บ

  switch (action) {
    case "dashboard":
      return dashboardAPI();
    case "weather":
      return jsonOutput({ success: true, data: getWeatherForecast(new Date()) });
    case "pm25":
      return jsonOutput({ success: true, data: getPM25() });
    case "web":
    default:
      // ดึงไฟล์ Index.html มาแสดงผลเป็นหน้าเว็บ
      return HtmlService.createHtmlOutputFromFile('Index')
        .setTitle('School Smart Assistant - Admin Panel')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
}

// --- ฟังก์ชันสำหรับดึงข้อมูล (อัปเกรดรองรับทุกชีต) ---
function getTableDataForWeb(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];

  const displayValues = sheet.getDataRange().getDisplayValues();
  const actualValues = sheet.getDataRange().getValues();
  if (displayValues.length <= 1) return displayValues;

  const header = displayValues[0];

  // 📌 สำหรับชีตทั่วไป (DUTY, UNIFORM, TEACHERS)
  if (sheetName !== 'CALENDAR') {
    let result = [header];
    for (let i = 1; i < displayValues.length; i++) {
      let row = [...displayValues[i]];
      row.push(i); // แอบแนบเลขบรรทัดไว้ช่องสุดท้ายสำหรับใช้อ้างอิงตอนลบ/แก้ไข
      result.push(row);
    }
    return result;
  }

  // 📌 สำหรับ CALENDAR (จัดเรียงตามวันที่เหมือนเดิม)
  let rows = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  for (let i = 1; i < displayValues.length; i++) {
    let rawDate = actualValues[i][0];
    let timeObj = 0;
    
    if (rawDate instanceof Date) {
      timeObj = rawDate.getTime();
    } else if (rawDate) {
      let parsed = Date.parse(rawDate);
      if (!isNaN(parsed)) timeObj = parsed;
    }

    rows.push({
      dateStr: displayValues[i][0],
      nameStr: displayValues[i][1],
      colorStr: displayValues[i][2] || '#60a5fa',
      timestamp: timeObj,
      originalIndex: i
    });
  }

  rows.sort((a, b) => {
    const isPastA = a.timestamp < todayTime && a.timestamp !== 0;
    const isPastB = b.timestamp < todayTime && b.timestamp !== 0;
    if (isPastA && !isPastB) return 1;  
    if (!isPastA && isPastB) return -1; 
    return a.timestamp - b.timestamp; 
  });

  const result = [header];
  for (let r of rows) {
    result.push([r.dateStr, r.nameStr, r.originalIndex, r.timestamp, r.colorStr]);
  }
  return result;
}
// --- ฟังก์ชันสำหรับบันทึกข้อมูลใหม่ลง Sheet จากหน้าเว็บ ---
function appendDataFromWeb(sheetName, rowData) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    sheet.appendRow(rowData);
    return { success: true, message: "✅ บันทึกข้อมูลเรียบร้อยแล้ว!" };
  } catch (error) {
    return { success: false, message: "❌ เกิดข้อผิดพลาด: " + error.message };
  }
}
function jsonOutput(data){
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function dashboardAPI(){

  const targetDate = new Date();

  const data = {

    weather: getWeatherForecast(targetDate),

    pm25: getPM25(),

    report: generateDailyReport(),

    time: Utilities.formatDate(
      new Date(),
      CONFIG.LOCATION.TIMEZONE,
      "yyyy-MM-dd HH:mm:ss"
    )

  };

  return jsonOutput({
    success:true,
    data:data
  });

}
// ============================================================================
// 🟢 4. EXECUTION (จุดสั่งรันโปรแกรม)
// ============================================================================

function testDailyNotification() {
  const reportMessage = generateDailyReport();
  sendTelegramMessage(reportMessage);
  Logger.log("✅ ส่งข้อความแจ้งเตือนสำเร็จ!");
}

function dashboardV2() {

  const targetDate = new Date();

  const weatherText = getWeatherForecast(targetDate);
  const pmText = getPM25();

  const data = {

    school: CONFIG.LOCATION.NAME,

    datetime: Utilities.formatDate(
      new Date(),
      CONFIG.LOCATION.TIMEZONE,
      "dd/MM/yyyy HH:mm"
    ),

    weather: weatherText,

    pm25: pmText

  };

  return jsonOutput(data);

}
// ==========================================
// ส่วนของการ จัดการข้อมูล (แก้ไข / ลบ) ผ่านหน้าเว็บ
// ==========================================

// --- ฟังก์ชันลบข้อมูล ---
function deleteRowFromWeb(sheetName, rowIndex) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    // rowIndex + 1 เพราะแถวใน Sheet เริ่มที่ 1 (และนับรวมแถวหัวตารางด้วย)
    sheet.deleteRow(rowIndex + 1);
    return { success: true, message: "🗑️ ลบข้อมูลเรียบร้อย!" };
  } catch (error) {
    return { success: false, message: "❌ ลบข้อมูลล้มเหลว: " + error.message };
  }
}

// --- ฟังก์ชันแก้ไขข้อมูล ---
function updateRowFromWeb(sheetName, rowIndex, newData) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    // newData เป็น Array เช่น [newDate, newName]
    // getRange(แถวที่, คอลัมน์ที่, จำนวนแถว, จำนวนคอลัมน์)
    sheet.getRange(rowIndex + 1, 1, 1, newData.length).setValues([newData]);
    return { success: true, message: "✅ อัปเดตข้อมูลเรียบร้อย!" };
  } catch (error) {
    return { success: false, message: "❌ อัปเดตล้มเหลว: " + error.message };
  }
}
function sendMenuWithButton() {
  // 1. เอา URL ที่ได้จากการ Deploy มาใส่ตรงนี้ครับ
  const webAppUrl = "https://script.google.com/macros/s/AKfycbz1Ev8LKQ2d7kKoc2MVg5c5czJmTAKrSVoK0uWbRpmy81GE1AH95cJQm6lGUJpbunTc6w/exec"; 
  
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/sendMessage`;
  
  // 2. สร้างโครงสร้างปุ่มกด
  const keyboard = {
    inline_keyboard: [
      [
        { text: "⚙️ เปิดหน้าเว็บจัดการข้อมูล", url: webAppUrl }
      ]
    ]
  };

  const payload = {
    chat_id: CONFIG.TELEGRAM.DEFAULT_CHAT_ID,
    text: "🎛️ <b>เมนูการจัดการ School Smart Assistant</b>\nคลิกปุ่มด้านล่างเพื่อเข้าไปแก้ไขปฏิทินกิจกรรมครับ",
    parse_mode: 'HTML',
    // 3. แนบปุ่มไปกับข้อความด้วย reply_markup
    reply_markup: JSON.stringify(keyboard) 
  };

  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });
    Logger.log("✅ ส่งเมนูพร้อมปุ่มสำเร็จ!");
  } catch (error) {
    Logger.log(`[Error] ${error.message}`);
  }
}
