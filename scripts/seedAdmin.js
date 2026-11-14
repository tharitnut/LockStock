import bcrypt from 'bcryptjs';
import db from '../src/db.js';
import config from '../src/config.js';

async function seedAdmin() {
  const email = config.adminEmail;
  const password = config.adminPassword;

  if (!email || !password) {
    console.error('Error: ADMIN_EMAIL and ADMIN_PASSWORD must be provided');
    process.exit(1);
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const existingUser = await db('users').where({ email }).first();

  if (existingUser) {
    await db('users')
      .where({ email })
      .update({
        password_hash: passwordHash,
        role: 'admin',
      });
    console.log(`Admin user '${email}' already exists. Password and role updated.`);
  } else {
    await db('users').insert({
      email,
      password_hash: passwordHash,
      role: 'admin',
    });
    console.log(`Admin user '${email}' successfully created.`);
  }

  await db.destroy();
  process.exit(0);
}

seedAdmin().catch(async (err) => {
  console.error('Failed to seed admin:', err);
  await db.destroy();
  process.exit(1);
});
