// api/auth.js - Vercel Serverless Function
// نظام المصادقة وإدارة التراخيص - النسخة الخلفية
// الإصدار: 3.1
// آخر تحديث: 2026-03-10

const fetch = require('node-fetch');

// ======================== الإعدادات العامة ========================
const FIREBASE_CONFIG = {
    databaseURL: "https://test-3b890-default-rtdb.firebaseio.com/"
};

// روابط APIs
const APIS = {
    VERIFY: "https://script.google.com/macros/s/AKfycbyXyhZPA-xMWsal6fpi-8dXV7hHBfjm8XEwGnHAAxEwSJAK3Qlcjh0zy3EOXbe6yGNm/exec",
    LOGIN_RECORD: "https://script.google.com/macros/s/AKfycbzfpHuNaSs-96CSVnrDHtcf9_gRsJvbWZfs0cz3K4U81wkjogA1zbAUy11C71aOMY1eSA/exec"
};

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

// ======================== Firebase Admin ========================
let admin = null;
let database = null;

/**
 * تهيئة Firebase Admin SDK
 * requires environment variables:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_PRIVATE_KEY
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_DATABASE_URL
 */
async function initFirebaseAdmin() {
    if (admin && database) return { admin, database };
    
    try {
        // محاولة استخدام Firebase Admin SDK إذا كانت المتغيرات البيئية موجودة
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
            admin = require('firebase-admin');
            
            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
                    }),
                    databaseURL: process.env.FIREBASE_DATABASE_URL || FIREBASE_CONFIG.databaseURL
                });
            }
            
            database = admin.database();
            console.log('✅ Firebase Admin initialized');
            return { admin, database };
        }
        
        // إذا لم تكن المتغيرات البيئية متوفرة، نستخدم REST API
        console.log('⚠️ Using Firebase REST API (no admin credentials)');
        return { admin: null, database: null };
        
    } catch (error) {
        console.error('❌ Firebase initialization error:', error);
        return { admin: null, database: null };
    }
}

/**
 * جلب بيانات من Firebase باستخدام REST API
 */
async function fetchFromFirebase(path) {
    try {
        const url = `${FIREBASE_CONFIG.databaseURL}${path}.json`;
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error fetching from Firebase (${path}):`, error);
        return null;
    }
}

/**
 * كتابة بيانات إلى Firebase باستخدام REST API
 */
async function writeToFirebase(path, data) {
    try {
        const url = `${FIREBASE_CONFIG.databaseURL}${path}.json`;
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
 * إضافة بيانات إلى Firebase (push) باستخدام REST API
 */
async function pushToFirebase(path, data) {
    try {
        const url = `${FIREBASE_CONFIG.databaseURL}${path}.json`;
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
        // البحث في جدول roles
        const roles = await fetchFromFirebase('roles');
        
        if (roles && roles[roleId]) {
            // إذا وجدنا الدور، نعيد اسمه
            return roles[roleId].name || roles[roleId].title || 'موظف';
        }
        
        // إذا كان roleId هو owner أو كلمة محددة
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
        
        // البحث في كل مالك
        for (const [ownerId, ownerData] of Object.entries(owners)) {
            const profile = ownerData.profile;
            if (!profile) continue;
            
            // التحقق من اسم المستخدم (يمكن أن يكون الإيميل أو أي حقل آخر)
            if (profile.email === username) {
                // تشفير كلمة المرور المدخلة ومقارنتها مع المشفرة المخزنة
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
 * البحث عن موظف في قاعدة البيانات مع قراءة دوره من جدول roles
 * @param {string} username - اسم المستخدم
 * @param {string} password - كلمة المرور
 * @returns {Promise<Object|null>} بيانات الموظف أو null
 */
async function findEmployee(username, password) {
    try {
        const employees = await fetchFromFirebase('employees');
        
        if (!employees) return null;
        
        // البحث في كل موظف
        for (const [empId, empData] of Object.entries(employees)) {
            // يمكن أن يكون اسم المستخدم هو username أو email
            if (empData.username === username || empData.email === username) {
                if (empData.password === password) {
                    
                    // قراءة اسم الدور من جدول roles إذا كان موجوداً
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
        console.error('خطأ في البحث عن الموظف:', error);
        return null;
    }
}

// ======================== دوال التحقق من الاشتراك (الترخيص) ========================

/**
 * التحقق من صحة كود الترخيص
 * @param {string} code - كود الترخيص
 * @returns {Promise<Object|null>} بيانات الترخيص أو null
 */
async function verifyLicenseCode(code) {
    if (!code) return null;
    
    try {
        // أولاً: التحقق من وجود الكود في إعدادات التصميم
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
                endDate: subData.endDate
            };
        }
        
        // إذا لم نجد في Firebase، نستخدم API خارجي
        // إذا لم نجد في Firebase، نستخدم API خارجي
        const response = await fetch(`${APIS.VERIFY}?code=${encodeURIComponent(code)}`);
        const data = await response.json();

        if (data && data.success && data.data) {

            return {
                success: true,
                subscriptionCode: data.data["الكود "] || code,
                user: data.data["User"] || "غير معروف",
                status: data.data["Status"] || "Inactive",
                daysRemaining: data.data["عدد الايام اللي ناقصه"] || 0,
                type: data.data["نوع الاشتراك"] || "",
                startDate: data.data["تاريخ البدايه"] || "",
                duration: data.data["مده التفعيل "] || 0
            };

        }

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
        
        // معلومات الجهاز (محاكاة للباك اند)
        const loginEntry = {
            timestamp: timestamp,
            status: status,
            ip: 'server-side',
            device: 'Vercel Server',
            location: 'مصر'
        };
        
        // إضافة إلى سجل الدخول
        await pushToFirebase(`owners/${ownerId}/loginHistory`, loginEntry);
        
        // تسجيل النشاط
        const activityEntry = {
            timestamp: timestamp,
            action: status === 'success' ? 'تسجيل دخول ناجح' : 'محاولة دخول فاشلة',
            details: status === 'success' ? 'تم تسجيل الدخول بنجاح' : 'فشل تسجيل الدخول',
            performedBy: 'owner'
        };
        await pushToFirebase(`owners/${ownerId}/activityLog`, activityEntry);
        
    } catch (error) {
        console.error('خطأ في تسجيل سجل المالك:', error);
    }
}

// ======================== دالة تسجيل الدخول الرئيسية ========================

/**
 * معالج تسجيل الدخول الرئيسي
 * @param {Object} credentials - بيانات تسجيل الدخول { username, password, licenseCode }
 * @returns {Promise<Object>} نتيجة تسجيل الدخول
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
        // تهيئة Firebase
        await initFirebaseAdmin();
        
        // 1. البحث عن المالك أولاً
        const owner = await findOwner(username, password);
        
        if (owner) {
            // تسجيل الدخول الناجح في سجل المالك
            await recordOwnerLogin(owner.id, 'success');
            
            // تخزين رمز الترخيص إذا كان موجوداً
            if (licenseCode) {
                // يمكن تخزينه في الجلسة
            }
            
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
                message: `مرحباً بك ${owner.name} (Owner)`,
                redirectTo: 'dashboard.html'
            };
        }
        
        // 2. إذا لم يكن مالكاً، نبحث بين الموظفين
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

// ======================== دالة التحقق من الترخيص ========================

/**
 * التحقق من صحة كود الترخيص وإرجاع التفاصيل
 * @param {Object} params - معاملات التحقق { licenseCode }
 * @returns {Promise<Object>} نتيجة التحقق
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
        await initFirebaseAdmin();
        
        const licenseData = await verifyLicenseCode(licenseCode);
        
        if (licenseData && licenseData.success) {
            return {
                success: true,
                licenseData: {
                    subscriptionCode: licenseData.subscriptionCode || licenseCode,
                    status: licenseData.status === 'Active' ? 'نشط' : 'منتهي',
                    statusClass: licenseData.status === 'Active' ? 'status-active' : 'status-expired',
                    userName: licenseData.user || 'غير معروف',
                    daysRemaining: licenseData.daysRemaining || 0,
                    type: licenseData.type,
                    startDate: licenseData.startDate,
                    endDate: licenseData.endDate
                },
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

// ======================== دالة استعادة بيانات المستخدم ========================

/**
 * استعادة بيانات المستخدم من التوكن أو الجلسة
 * @param {Object} params - معاملات الاستعادة { userId, userRole, userData }
 * @returns {Promise<Object>} بيانات المستخدم مع اسم الدور المحدث
 */
async function getUserWithRole(params) {
    const { userId, userRole, userData } = params;
    
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
        
        return {
            success: true,
            user: {
                id: userId,
                role: userRole,
                roleName: roleName,
                name: userData?.name || '',
                code: userData?.code || ''
            }
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

// ======================== دوال التحقق من الصلاحيات ========================

/**
 * التحقق من صلاحيات المستخدم
 * @param {Object} params - معاملات التحقق { userRole, requiredPermission }
 * @returns {Object} نتيجة التحقق
 */
function hasPermission(params) {
    const { userRole, requiredPermission } = params;
    
    if (!userRole) {
        return { success: false, hasPermission: false };
    }
    
    // المالك لديه كل الصلاحيات
    if (userRole === 'owner') {
        return { success: true, hasPermission: true };
    }
    
    // يمكن إضافة منطق التحقق من الصلاحيات للموظفين هنا
    // حسب هيكل الصلاحيات في roles
    
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

// ======================== معالج Vercel الرئيسي ========================

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
        
        // مسار التحقق من الترخيص
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
        
        // مسار استعادة بيانات المستخدم مع الدور
        if (path === '/api/auth/get-user-role' && method === 'POST') {
            const body = req.body || {};
            const result = await getUserWithRole(body);
            return res.status(200).json(result);
        }
        
        // مسار التحقق من الصلاحية
        if (path === '/api/auth/has-permission' && method === 'POST') {
            const body = req.body || {};
            const result = hasPermission(body);
            return res.status(200).json(result);
        }
        
        // مسار الحصول على اسم الدور
        if (path === '/api/auth/get-role-name' && method === 'POST') {
            const body = req.body || {};
            const result = getCurrentRoleName(body);
            return res.status(200).json(result);
        }
        
        // مسار تسجيل الخروج (خدمة جانبية)
        if (path === '/api/auth/signout' && method === 'POST') {
            return res.status(200).json({
                success: true,
                message: 'تم تسجيل الخروج بنجاح'
            });
        }
        
        // مسار اختبار الصحة
        if (path === '/api/auth/health' && method === 'GET') {
            return res.status(200).json({
                status: 'ok',
                version: '3.1',
                timestamp: new Date().toISOString()
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

// تصدير الدوال للاستخدام في مكان آخر إذا لزم الأمر
module.exports.signIn = signIn;
module.exports.verifyLicense = verifyLicense;
module.exports.getUserWithRole = getUserWithRole;
module.exports.hasPermission = hasPermission;
module.exports.getCurrentRoleName = getCurrentRoleName;
module.exports.getRoleName = getRoleName;
module.exports.findOwner = findOwner;
module.exports.findEmployee = findEmployee;
module.exports.verifyLicenseCode = verifyLicenseCode;
module.exports.recordOwnerLogin = recordOwnerLogin;
module.exports.hashPassword = hashPassword;
module.exports.decodeHash = decodeHash;
