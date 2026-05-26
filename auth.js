// api/auth.js - Vercel Serverless Function
// نظام المصادقة وإدارة التراخيص - النسخة الخلفية
// الإصدار: 3.3
// آخر تحديث: 2026-03-10
// التعديل: دعم العملاء المتعددين (Multi-tenant) مع client_id

const fetch = require('node-fetch');

// ======================== الإعدادات العامة ========================

// قاعدة Firebase الافتراضية (للخلفية)
const DEFAULT_FIREBASE_CONFIG = {
    databaseURL: "https://test-3b890-default-rtdb.firebaseio.com/"
};

// ======================== تكوين العملاء (Client Configuration) ========================
// ربط client_id بقاعدة بيانات Firebase الخاصة به
// يمكنك إضافة المزيد من العملاء هنا
const CLIENTS_CONFIG = {
    "client_1": {
        databaseURL: "https://test-3b890-default-rtdb.firebaseio.com/",  // استبدل بالرابط الحقيقي
        projectId: "client1-xxxxx",  // معرف المشروع (اختياري)
        description: "اول عميل "
    },
    "client_2": {
        databaseURL: "https://client2-xxxxx-default-rtdb.firebaseio.com/",  // استبدل بالرابط الحقيقي
        projectId: "client2-xxxxx",
        description: "عميل رقم 2"
    },
    // يمكنك إضافة المزيد من العملاء حسب الحاجة
    // "client_3": {
    //     databaseURL: "https://client3-xxxxx-default-rtdb.firebaseio.com/",
    //     projectId: "client3-xxxxx",
    //     description: "عميل رقم 3"
    // }
};

// متغير لحفظ إعدادات قاعدة البيانات الحالية (لكل طلب)
let currentFirebaseConfig = { ...DEFAULT_FIREBASE_CONFIG };
let currentClientId = null;

// روابط APIs
const APIS = {
    VERIFY: "https://script.google.com/macros/s/AKfycbyztFTOFHunQKahA99RskXGKx6Sh9CUCLwij8gwHqDd0UUblmJ6DCzzGfAMCXf7iS1P/exec",
    LOGIN_RECORD: "https://script.google.com/macros/s/AKfycbzfpHuNaSs-96CSVnrDHtcf9_gRsJvbWZfs0cz3K4U81wkjogA1zbAUy11C71aOMY1eSA/exec"
};

// ======================== دوال مساعدة لإدارة العملاء ========================

/**
 * الحصول على إعدادات Firebase الخاصة بالعميل
 * @param {string} clientId - معرف العميل
 * @returns {Object} إعدادات Firebase للعميل
 */
function getClientFirebaseConfig(clientId) {
    if (!clientId) {
        console.log('⚠️ لا يوجد client_id، استخدام الإعدادات الافتراضية');
        return { ...DEFAULT_FIREBASE_CONFIG };
    }
    
    if (CLIENTS_CONFIG[clientId]) {
        console.log(`✅ تم العثور على تكوين للعميل: ${clientId}`);
        return {
            databaseURL: CLIENTS_CONFIG[clientId].databaseURL,
            projectId: CLIENTS_CONFIG[clientId].projectId
        };
    }
    
    console.log(`⚠️ لم يتم العثور على تكوين للعميل: ${clientId}، استخدام الإعدادات الافتراضية`);
    return { ...DEFAULT_FIREBASE_CONFIG };
}

/**
 * تحديث إعدادات قاعدة البيانات الحالية بناءً على client_id
 * @param {string} clientId - معرف العميل
 */
function updateFirebaseConfig(clientId) {
    if (clientId && clientId !== currentClientId) {
        currentClientId = clientId;
        currentFirebaseConfig = getClientFirebaseConfig(clientId);
        console.log(`🔄 تم تحديث إعدادات Firebase للعميل: ${clientId}`);
        console.log(`📡 قاعدة البيانات: ${currentFirebaseConfig.databaseURL}`);
    }
}

/**
 * إعادة ضبط إعدادات Firebase إلى الافتراضية
 */
function resetFirebaseConfig() {
    currentClientId = null;
    currentFirebaseConfig = { ...DEFAULT_FIREBASE_CONFIG };
    console.log('🔄 تم إعادة ضبط إعدادات Firebase إلى الإعدادات الافتراضية');
}

/**
 * الحصول على رابط Firebase الحالي
 * @returns {string} رابط قاعدة البيانات الحالي
 */
function getCurrentDatabaseURL() {
    return currentFirebaseConfig.databaseURL;
}

// ======================== دوال مساعدة للتشفير ========================

/**
 * تشفير النص إلى Base64
 * @param {string} str - النص المراد تشفيره
 * @returns {string} النص المشفر
 */
function hashPassword(str) {
    if (!str) return '';
    try {
        return Buffer.from(str).toString('base64');
    } catch (e) {
        console.error('خطأ في تشفير كلمة المرور:', e);
        return '';
    }
}

/**
 * فك تشفير النص من Base64
 * @param {string} str - النص المشفر
 * @returns {string} النص الأصلي
 */
function decodeHash(str) {
    if (!str) return '';
    try {
        return Buffer.from(str, 'base64').toString('utf8');
    } catch (e) {
        return '';
    }
}

// ======================== Firebase Admin (معدل لدعم العملاء المتعددين) ========================
let admin = null;
let database = null;

/**
 * تهيئة Firebase Admin SDK (باستخدام الإعدادات الحالية)
 */
async function initFirebaseAdmin() {
    if (admin && database) return { admin, database };
    
    try {
        // استخدام إعدادات العميل الحالية إذا كانت موجودة
        const databaseURL = currentFirebaseConfig.databaseURL;
        
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
            admin = require('firebase-admin');
            
            if (!admin.apps.length) {
                // إذا كان هناك client_id محدد، نستخدم Project ID الخاص بالعميل
                const projectId = currentFirebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID;
                
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: projectId,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
                    }),
                    databaseURL: databaseURL
                });
            }
            
            database = admin.database();
            console.log(`✅ Firebase Admin initialized with database: ${databaseURL}`);
            return { admin, database };
        }
        
        console.log(`⚠️ Using Firebase REST API with database: ${databaseURL}`);
        return { admin: null, database: null };
        
    } catch (error) {
        console.error('❌ Firebase initialization error:', error);
        return { admin: null, database: null };
    }
}

/**
 * جلب بيانات من Firebase باستخدام REST API (معدل لدعم client_id)
 */
async function fetchFromFirebase(path) {
    try {
        const databaseURL = getCurrentDatabaseURL();
        const url = `${databaseURL}${path}.json`;
        console.log(`📡 Fetching: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error fetching from Firebase (${path}):`, error);
        return null;
    }
}

/**
 * كتابة بيانات إلى Firebase باستخدام REST API (معدل لدعم client_id)
 */
async function writeToFirebase(path, data) {
    try {
        const databaseURL = getCurrentDatabaseURL();
        const url = `${databaseURL}${path}.json`;
        console.log(`📡 Writing to: ${url}`);
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.error(`Error writing to Firebase (${path}):`, error);
        return null;
    }
}

/**
 * إضافة بيانات إلى Firebase (push) باستخدام REST API (معدل لدعم client_id)
 */
async function pushToFirebase(path, data) {
    try {
        const databaseURL = getCurrentDatabaseURL();
        const url = `${databaseURL}${path}.json`;
        console.log(`📡 Pushing to: ${url}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.error(`Error pushing to Firebase (${path}):`, error);
        return null;
    }
}

// ======================== دالة الحصول على اسم الدور بشكل احترافي ========================

/**
 * الحصول على اسم الدور بشكل احترافي من جدول roles
 * @param {string} roleId - معرف الدور
 * @returns {Promise<string>} اسم الدور
 */
async function getRoleName(roleId) {
    if (!roleId) return 'موظف';
    
    try {
        const roles = await fetchFromFirebase('roles');
        
        if (roles && roles[roleId]) {
            return roles[roleId].name || roles[roleId].title || 'موظف';
        }
        
        if (roleId === 'owner' || roleId === 'OWNER') {
            return 'Owner';
        }
        
        return 'موظف';
    } catch (error) {
        console.error('خطأ في الحصول على اسم الدور:', error);
        return 'موظف';
    }
}

// ======================== دوال التحقق من المالك (owner) ========================

/**
 * البحث عن المالك في قاعدة البيانات
 * @param {string} username - اسم المستخدم
 * @param {string} password - كلمة المرور
 * @returns {Promise<Object|null>} بيانات المالك أو null
 */
async function findOwner(username, password) {
    try {
        const owners = await fetchFromFirebase('owners');
        
        if (!owners) return null;
        
        for (const [ownerId, ownerData] of Object.entries(owners)) {
            const profile = ownerData.profile;
            if (!profile) continue;
            
            if (profile.email === username) {
                const hashedInput = hashPassword(password);
                if (hashedInput === profile.passwordHash) {
                    return {
                        id: ownerId,
                        name: profile.name || 'المالك',
                        email: profile.email,
                        phone: profile.phone,
                        role: 'owner',
                        roleName: 'Owner',
                        code: 'OWNER'
                    };
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('خطأ في البحث عن المالك:', error);
        return null;
    }
}

// ======================== دوال التحقق من الموظفين ========================

/**
 * البحث عن موظف في قاعدة البيانات
 * @param {string} username - اسم المستخدم
 * @param {string} password - كلمة المرور
 * @returns {Promise<Object|null>} بيانات الموظف أو null
 */
async function findEmployee(username, password) {
    try {
        const employees = await fetchFromFirebase('employees');
        
        if (!employees) return null;
        
        for (const [empId, empData] of Object.entries(employees)) {
            if (empData.username === username || empData.email === username) {
                if (empData.password === password) {
                    
                    let roleName = 'موظف';
                    if (empData.roleId) {
                        const roleData = await fetchFromFirebase(`roles/${empData.roleId}`);
                        if (roleData) {
                            roleName = roleData.name || roleData.title || 'موظف';
                        }
                    }
                    
                    return {
                        id: empId,
                        name: empData.name,
                        username: empData.username,
                        email: empData.email,
                        role: empData.roleId || 'employee',
                        roleName: roleName,
                        code: empData.employeeCode || 'EMP'
                    };
                }
            }
        }
        
        return null;

    } catch (error) {
        console.error('خطأ في التحقق من الترخيص:', error);
        return null;
    }
}

// ======================== دوال التحقق من الاشتراك (الترخيص) - معدلة لدعم client_id ========================

/**
 * التحقق من صحة كود الترخيص - إصدار يدعم الهيكل الجديد و client_id
 * @param {string} code - كود الترخيص
 * @returns {Promise<Object|null>} بيانات الترخيص الكاملة مع الـ limits و pages و client_id
 */
async function verifyLicenseCode(code) {
    if (!code) return null;
    
    try {
        // أولاً: محاولة جلب البيانات من Google Sheet API
        const response = await fetch(`${APIS.VERIFY}?code=${encodeURIComponent(code)}`);
        const data = await response.json();

        if (data && data.success === true && data.data) {
            // معالجة البيانات حسب الهيكل الجديد
            const licenseData = data.data;
            
            // استخراج client_id من الرد
            const clientId = data.database?.client_id || null;
            
            // تحديث إعدادات Firebase بناءً على client_id (مهم!)
            if (clientId) {
                updateFirebaseConfig(clientId);
                console.log(`✅ تم تعيين قاعدة البيانات للعميل: ${clientId}`);
            }
            
            // حساب الأيام المتبقية بشكل صحيح
            let daysRemaining = licenseData["عدد الايام اللي ناقصه"] || 0;
            let status = licenseData["Status"] || "Inactive";
            
            // تحويل تاريخ البدء من ISO string إلى تاريخ عادي
            let startDate = licenseData["تاريخ البدايه"] || "";
            if (startDate) {
                const date = new Date(startDate);
                startDate = date.toLocaleDateString('ar-EG');
            }
            
            // حساب تاريخ الانتهاء
            let endDate = "";
            if (startDate && licenseData["مده التفعيل"]) {
                const start = new Date(licenseData["تاريخ البدايه"]);
                const end = new Date(start);
                end.setDate(end.getDate() + (licenseData["مده التفعيل"] || 0));
                endDate = end.toLocaleDateString('ar-EG');
            }
            
            return {
                success: true,
                subscriptionCode: licenseData["الكود"] || code,
                user: licenseData["User"] || "غير معروف",
                status: status,
                statusClass: status === "Active" ? "status-active" : "status-expired",
                daysRemaining: daysRemaining,
                type: licenseData["نوع الاشتراك"] || "Basic",
                startDate: startDate,
                endDate: endDate,
                duration: licenseData["مده التفعيل"] || 0,
                // إضافة client_id
                clientId: clientId,
                // إضافة الـ limits
                limits: data.limits || {
                    employees: 0,
                    invoices: 0,
                    warehouses: 0
                },
                // إضافة الصفحات المسموحة
                pages: data.pages || {},
                // حفظ بيانات قاعدة البيانات
                database: data.database || {},
                // حفظ البيانات الخام أيضاً إذا احتجناها
                rawData: data
            };
        }
        
        // إذا لم نجد في API، نبحث في Firebase (مع الإعدادات الحالية)
        const subData = await fetchFromFirebase('design-system/subscription');
        
        if (subData && subData.code === code) {
            return {
                success: true,
                subscriptionCode: subData.code,
                user: subData.username || 'مستخدم النظام',
                status: subData.status === 'نشط' ? 'Active' : 'Inactive',
                daysRemaining: subData.remainingDays || 365,
                type: subData.type || 'عادي',
                startDate: subData.startDate,
                endDate: subData.endDate,
                clientId: currentClientId,
                limits: {
                    employees: subData.maxEmployees || 10,
                    invoices: subData.maxInvoices || 1000,
                    warehouses: subData.maxWarehouses || 5
                },
                pages: subData.pages || {}
            };
        }

        return null;
    } catch (error) {
        console.error('خطأ في التحقق من الترخيص:', error);
        return null;
    }
}

/**
 * تسجيل محاولة الدخول في سجل المالك
 * @param {string} ownerId - معرف المالك
 * @param {string} status - حالة الدخول (success/failed)
 */
async function recordOwnerLogin(ownerId, status = 'success') {
    if (!ownerId) return;
    
    try {
        const now = new Date();
        const timestamp = now.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
        
        const loginEntry = {
            timestamp: timestamp,
            status: status,
            ip: 'server-side',
            device: 'Vercel Server',
            location: 'مصر',
            clientId: currentClientId  // إضافة client_id للتسجيل
        };
        
        await pushToFirebase(`owners/${ownerId}/loginHistory`, loginEntry);
        
        const activityEntry = {
            timestamp: timestamp,
            action: status === 'success' ? 'تسجيل دخول ناجح' : 'محاولة دخول فاشلة',
            details: status === 'success' ? 'تم تسجيل الدخول بنجاح' : 'فشل تسجيل الدخول',
            performedBy: 'owner',
            clientId: currentClientId
        };
        await pushToFirebase(`owners/${ownerId}/activityLog`, activityEntry);
        
    } catch (error) {
        console.error('خطأ في تسجيل سجل المالك:', error);
    }
}

// ======================== دالة تسجيل الدخول الرئيسية (معدلة لدعم client_id) ========================

/**
 * معالج تسجيل الدخول الرئيسي
 * @param {Object} credentials - بيانات تسجيل الدخول { username, password, licenseCode }
 * @returns {Promise<Object>} نتيجة تسجيل الدخول مع الـ limits و الصفحات و client_id
 */
async function signIn(credentials) {
    const { username, password, licenseCode } = credentials;
    
    if (!username || !password) {
        return {
            success: false,
            message: 'الرجاء إدخال اسم المستخدم وكلمة المرور',
            code: 'MISSING_CREDENTIALS'
        };
    }
    
    try {
        // التحقق من الترخيص أولاً إذا تم إدخال كود (هذا سيحدد client_id تلقائياً)
        let licenseData = null;
        if (licenseCode) {
            licenseData = await verifyLicenseCode(licenseCode);
        }
        
        // تهيئة Firebase Admin بعد تحديد client_id
        await initFirebaseAdmin();
        
        // 1. البحث عن المالك أولاً
        const owner = await findOwner(username, password);
        
        if (owner) {
            await recordOwnerLogin(owner.id, 'success');
            
            return {
                success: true,
                user: {
                    id: owner.id,
                    name: owner.name,
                    email: owner.email,
                    role: owner.role,
                    roleName: owner.roleName,
                    code: owner.code
                },
                // إضافة بيانات الترخيص إذا وجدت
                license: licenseData,
                // إضافة client_id للرد
                clientId: currentClientId,
                databaseURL: getCurrentDatabaseURL(),
                message: `مرحباً بك ${owner.name} (Owner)`,
                redirectTo: 'dashboard.html'
            };
        }
        
        // 2. البحث بين الموظفين
        const employee = await findEmployee(username, password);
        
        if (employee) {
            return {
                success: true,
                user: {
                    id: employee.id,
                    name: employee.name,
                    username: employee.username,
                    email: employee.email,
                    role: employee.role,
                    roleName: employee.roleName,
                    code: employee.code
                },
                // إضافة بيانات الترخيص إذا وجدت
                license: licenseData,
                // إضافة client_id للرد
                clientId: currentClientId,
                databaseURL: getCurrentDatabaseURL(),
                message: `مرحباً بك ${employee.name} (${employee.roleName})`,
                redirectTo: 'dashboard.html'
            };
        }
        
        // 3. إذا لم يتم العثور على المستخدم
        return {
            success: false,
            message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
            code: 'INVALID_CREDENTIALS'
        };
        
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        return {
            success: false,
            message: 'حدث خطأ أثناء تسجيل الدخول. الرجاء المحاولة مرة أخرى.',
            code: 'SERVER_ERROR'
        };
    }
}

// ======================== دالة التحقق من الترخيص (معدلة لدعم client_id) ========================

/**
 * التحقق من صحة كود الترخيص وإرجاع التفاصيل الكاملة
 * @param {Object} params - معاملات التحقق { licenseCode }
 * @returns {Promise<Object>} نتيجة التحقق مع الـ limits و الصفحات و client_id
 */
async function verifyLicense(params) {
    const { licenseCode } = params;
    
    if (!licenseCode) {
        return {
            success: false,
            message: 'لا يوجد كود ترخيص نشط. الرجاء إدخال كود جديد.',
            code: 'NO_LICENSE'
        };
    }
    
    try {
        const licenseData = await verifyLicenseCode(licenseCode);
        
        if (licenseData && licenseData.success) {
            return {
                success: true,
                licenseData: {
                    subscriptionCode: licenseData.subscriptionCode,
                    status: licenseData.status === 'Active' ? 'نشط' : 'منتهي',
                    statusClass: licenseData.statusClass,
                    userName: licenseData.user,
                    daysRemaining: licenseData.daysRemaining,
                    type: licenseData.type,
                    startDate: licenseData.startDate,
                    endDate: licenseData.endDate,
                    duration: licenseData.duration,
                    // إضافة client_id
                    clientId: licenseData.clientId,
                    // إضافة الـ limits
                    limits: licenseData.limits,
                    // إضافة الصفحات المسموحة
                    pages: licenseData.pages
                },
                databaseURL: getCurrentDatabaseURL(),
                message: 'تم التحقق من الترخيص بنجاح'
            };
        } else {
            return {
                success: false,
                message: 'كود الترخيص غير صالح أو منتهي الصلاحية',
                code: 'INVALID_LICENSE'
            };
        }
    } catch (error) {
        console.error('خطأ في التحقق من الترخيص:', error);
        return {
            success: false,
            message: 'خطأ في التحقق من الترخيص',
            code: 'VERIFICATION_ERROR'
        };
    }
}

/**
 * الحصول على client_id الحالي وقاعدة البيانات
 * @returns {Object} معلومات العميل الحالي
 */
function getCurrentClientInfo() {
    return {
        clientId: currentClientId,
        databaseURL: getCurrentDatabaseURL(),
        config: currentClientId ? CLIENTS_CONFIG[currentClientId] : null
    };
}

// ======================== دوال للتعامل مع الصلاحيات بناءً على الصفحات ========================

/**
 * التحقق من صلاحية الوصول إلى صفحة معينة
 * @param {Object} params - معاملات التحقق { licenseCode, pageName, userRole }
 * @returns {Promise<Object>} نتيجة التحقق
 */
async function checkPageAccess(params) {
    const { licenseCode, pageName, userRole } = params;
    
    if (!pageName) {
        return {
            success: false,
            hasAccess: false,
            message: 'اسم الصفحة مطلوب'
        };
    }
    
    // المالك لديه صلاحية الوصول لكل الصفحات
    if (userRole === 'owner') {
        return {
            success: true,
            hasAccess: true,
            message: 'المالك لديه صلاحية الوصول'
        };
    }
    
    if (!licenseCode) {
        return {
            success: false,
            hasAccess: false,
            message: 'لا يوجد كود ترخيص للتحقق من الصلاحيات'
        };
    }
    
    try {
        const licenseData = await verifyLicenseCode(licenseCode);
        
        if (!licenseData || !licenseData.success) {
            return {
                success: false,
                hasAccess: false,
                message: 'الترخيص غير صالح'
            };
        }
        
        // التحقق من وجود الصفحة في قائمة الصفحات المسموحة
        const pages = licenseData.pages || {};
        const hasAccess = pages[pageName] === true;
        
        return {
            success: true,
            hasAccess: hasAccess,
            message: hasAccess ? 'مسموح بالوصول' : 'غير مسموح بالوصول إلى هذه الصفحة',
            pages: pages
        };
        
    } catch (error) {
        console.error('خطأ في التحقق من صلاحية الصفحة:', error);
        return {
            success: false,
            hasAccess: false,
            message: 'خطأ في التحقق من الصلاحيات'
        };
    }
}

/**
 * الحصول على قائمة الصفحات المسموحة للمستخدم
 * @param {Object} params - معاملات { licenseCode, userRole }
 * @returns {Promise<Object>} قائمة الصفحات المسموحة
 */
async function getAllowedPages(params) {
    const { licenseCode, userRole } = params;
    
    // المالك لديه كل الصفحات مسموحة
    if (userRole === 'owner') {
        return {
            success: true,
            allowedPages: 'all',
            message: 'المالك لديه صلاحية الوصول لجميع الصفحات'
        };
    }
    
    if (!licenseCode) {
        return {
            success: false,
            allowedPages: [],
            message: 'لا يوجد كود ترخيص'
        };
    }
    
    try {
        const licenseData = await verifyLicenseCode(licenseCode);
        
        if (!licenseData || !licenseData.success) {
            return {
                success: false,
                allowedPages: [],
                message: 'الترخيص غير صالح'
            };
        }
        
        const pages = licenseData.pages || {};
        
        // استخراج أسماء الصفحات المسموحة
        const allowedPages = Object.keys(pages).filter(pageName => pages[pageName] === true);
        
        return {
            success: true,
            allowedPages: allowedPages,
            allPages: pages,
            clientId: licenseData.clientId,
            message: `تم العثور على ${allowedPages.length} صفحة مسموحة`
        };
        
    } catch (error) {
        console.error('خطأ في جلب الصفحات المسموحة:', error);
        return {
            success: false,
            allowedPages: [],
            message: 'خطأ في جلب البيانات'
        };
    }
}

/**
 * الحصول على الـ limits الخاصة بالترخيص
 * @param {Object} params - معاملات { licenseCode }
 * @returns {Promise<Object>} الـ limits
 */
async function getLicenseLimits(params) {
    const { licenseCode } = params;
    
    if (!licenseCode) {
        return {
            success: false,
            limits: null,
            message: 'لا يوجد كود ترخيص'
        };
    }
    
    try {
        const licenseData = await verifyLicenseCode(licenseCode);
        
        if (!licenseData || !licenseData.success) {
            return {
                success: false,
                limits: null,
                message: 'الترخيص غير صالح'
            };
        }
        
        return {
            success: true,
            limits: licenseData.limits || {
                employees: 0,
                invoices: 0,
                warehouses: 0
            },
            clientId: licenseData.clientId,
            message: 'تم جلب الـ limits بنجاح'
        };
        
    } catch (error) {
        console.error('خطأ في جلب الـ limits:', error);
        return {
            success: false,
            limits: null,
            message: 'خطأ في جلب البيانات'
        };
    }
}

// ======================== دوال مساعدة إضافية ========================

/**
 * استعادة بيانات المستخدم من التوكن أو الجلسة
 * @param {Object} params - معاملات الاستعادة { userId, userRole, userData, licenseCode }
 * @returns {Promise<Object>} بيانات المستخدم مع الصلاحيات
 */
async function getUserWithRole(params) {
    const { userId, userRole, userData, licenseCode } = params;
    
    if (!userId) {
        return {
            success: false,
            message: 'لا توجد بيانات مستخدم',
            code: 'NO_USER'
        };
    }
    
    try {
        await initFirebaseAdmin();
        
        let roleName = 'موظف';
        
        if (userRole === 'owner') {
            roleName = 'Owner';
        } else if (userRole) {
            roleName = await getRoleName(userRole);
        }
        
        // جلب بيانات الترخيص إذا وجدت
        let licenseInfo = null;
        if (licenseCode) {
            const licenseData = await verifyLicenseCode(licenseCode);
            if (licenseData && licenseData.success) {
                licenseInfo = {
                    limits: licenseData.limits,
                    pages: licenseData.pages,
                    status: licenseData.status,
                    daysRemaining: licenseData.daysRemaining,
                    clientId: licenseData.clientId
                };
            }
        }
        
        return {
            success: true,
            user: {
                id: userId,
                role: userRole,
                roleName: roleName,
                name: userData?.name || '',
                code: userData?.code || ''
            },
            license: licenseInfo,
            clientId: currentClientId,
            databaseURL: getCurrentDatabaseURL()
        };
        
    } catch (error) {
        console.error('خطأ في استعادة بيانات المستخدم:', error);
        return {
            success: false,
            message: 'خطأ في استعادة بيانات المستخدم',
            code: 'ERROR'
        };
    }
}

/**
 * التحقق من صلاحيات المستخدم (عام)
 * @param {Object} params - معاملات التحقق { userRole, requiredPermission, licenseCode }
 * @returns {Object} نتيجة التحقق
 */
async function hasPermission(params) {
    const { userRole, requiredPermission, licenseCode } = params;
    
    if (!userRole) {
        return { success: false, hasPermission: false };
    }
    
    // المالك لديه كل الصلاحيات
    if (userRole === 'owner') {
        return { success: true, hasPermission: true };
    }
    
    // يمكن إضافة منطق التحقق من الصلاحيات حسب الـ permissions من الترخيص
    if (licenseCode) {
        const licenseData = await verifyLicenseCode(licenseCode);
        // يمكن التحقق من صلاحيات محددة هنا
    }
    
    return { success: true, hasPermission: false };
}

/**
 * الحصول على اسم الدور الحالي
 * @param {Object} params - معاملات { userRole, userRoleName }
 * @returns {Object} اسم الدور
 */
function getCurrentRoleName(params) {
    const { userRole, userRoleName } = params;
    
    if (!userRole) {
        return { roleName: 'زائر' };
    }
    
    const roleName = userRoleName || (userRole === 'owner' ? 'Owner' : 'موظف');
    return { roleName };
}

// ======================== معالج Vercel الرئيسي (معدل لدعم client_id) ========================

module.exports = async (req, res) => {
    // إعدادات CORS
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:5500',
        'https://your-domain.vercel.app',
        'https://your-domain.com'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (process.env.NODE_ENV === 'development') {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // معالجة طلبات OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // تحديد المسار المطلوب
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    
    try {
        // مسار تسجيل الدخول
        if (path === '/api/auth/signin' && method === 'POST') {
            const body = req.body || (typeof req.body === 'string' ? JSON.parse(req.body) : {});
            const result = await signIn(body);
            return res.status(200).json(result);
        }
        
        // مسار التحقق من الترخيص (معدل)
        if (path === '/api/auth/verify-license' && (method === 'POST' || method === 'GET')) {
            let params = {};
            if (method === 'POST') {
                params = req.body || {};
            } else {
                params = { licenseCode: url.searchParams.get('code') };
            }
            const result = await verifyLicense(params);
            return res.status(200).json(result);
        }
        
        // مسار الحصول على معلومات العميل الحالي (جديد)
        if (path === '/api/auth/client-info' && method === 'GET') {
            const result = getCurrentClientInfo();
            return res.status(200).json({
                success: true,
                ...result
            });
        }
        
        // مسار التحقق من صلاحية صفحة
        if (path === '/api/auth/check-page-access' && method === 'POST') {
            const body = req.body || {};
            const result = await checkPageAccess(body);
            return res.status(200).json(result);
        }
        
        // مسار جلب الصفحات المسموحة
        if (path === '/api/auth/get-allowed-pages' && method === 'POST') {
            const body = req.body || {};
            const result = await getAllowedPages(body);
            return res.status(200).json(result);
        }
        
        // مسار جلب الـ limits
        if (path === '/api/auth/get-license-limits' && method === 'POST') {
            const body = req.body || {};
            const result = await getLicenseLimits(body);
            return res.status(200).json(result);
        }
        
        // مسار استعادة بيانات المستخدم مع الدور
        if (path === '/api/auth/get-user-role' && method === 'POST') {
            const body = req.body || {};
            const result = await getUserWithRole(body);
            return res.status(200).json(result);
        }
        
        // مسار التحقق من الصلاحية
        if (path === '/api/auth/has-permission' && method === 'POST') {
            const body = req.body || {};
            const result = await hasPermission(body);
            return res.status(200).json(result);
        }
        
        // مسار الحصول على اسم الدور
        if (path === '/api/auth/get-role-name' && method === 'POST') {
            const body = req.body || {};
            const result = getCurrentRoleName(body);
            return res.status(200).json(result);
        }
        
        // مسار تسجيل الخروج
        if (path === '/api/auth/signout' && method === 'POST') {
            // إعادة ضبط إعدادات Firebase عند تسجيل الخروج
            resetFirebaseConfig();
            return res.status(200).json({
                success: true,
                message: 'تم تسجيل الخروج بنجاح'
            });
        }
        
        // مسار اختبار الصحة
        if (path === '/api/auth/health' && method === 'GET') {
            return res.status(200).json({
                status: 'ok',
                version: '3.3',
                timestamp: new Date().toISOString(),
                features: ['license-limits', 'page-access', 'multi-tenant', 'client-id-support'],
                currentClient: currentClientId,
                databaseURL: getCurrentDatabaseURL()
            });
        }
        
        // مسار غير موجود
        return res.status(404).json({
            success: false,
            message: 'API endpoint not found',
            code: 'NOT_FOUND'
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            code: 'INTERNAL_ERROR',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// تصدير الدوال للاستخدام في مكان آخر
module.exports.signIn = signIn;
module.exports.verifyLicense = verifyLicense;
module.exports.verifyLicenseCode = verifyLicenseCode;
module.exports.getUserWithRole = getUserWithRole;
module.exports.hasPermission = hasPermission;
module.exports.getCurrentRoleName = getCurrentRoleName;
module.exports.getRoleName = getRoleName;
module.exports.findOwner = findOwner;
module.exports.findEmployee = findEmployee;
module.exports.recordOwnerLogin = recordOwnerLogin;
module.exports.hashPassword = hashPassword;
module.exports.decodeHash = decodeHash;
module.exports.checkPageAccess = checkPageAccess;
module.exports.getAllowedPages = getAllowedPages;
module.exports.getLicenseLimits = getLicenseLimits;
// تصدير دوال العملاء المتعددين الجديدة
module.exports.getClientFirebaseConfig = getClientFirebaseConfig;
module.exports.updateFirebaseConfig = updateFirebaseConfig;
module.exports.resetFirebaseConfig = resetFirebaseConfig;
module.exports.getCurrentClientInfo = getCurrentClientInfo;
module.exports.getCurrentDatabaseURL = getCurrentDatabaseURL;
