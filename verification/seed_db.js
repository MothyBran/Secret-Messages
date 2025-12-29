const Datastore = require('nedb-promises');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = './data';
const users = Datastore.create({ filename: path.join(dbPath, 'users.db'), autoload: true });
const keys = Datastore.create({ filename: path.join(dbPath, 'license_keys.db'), autoload: true });

async function seed() {
    console.log("🌱 Seeding DB...");

    // Create Master Key
    await keys.insert({
        key_code: 'MASTER-KEY-1234',
        key_hash: 'hash',
        product_code: 'MASTER',
        is_active: true,
        assigned_user_id: 'Admin_User'
    });

    // Create Admin User
    const hash = await bcrypt.hash('12345', 10);
    const u = await users.insert({
        username: 'Admin_User',
        access_code_hash: hash,
        is_admin: true,
        is_blocked: false,
        allowed_device_id: 'dev-123',
        license_key_id: 1 // rough guess or fetch
    });

    console.log("✅ Admin User Created: Admin_User / 12345");
}

seed();
