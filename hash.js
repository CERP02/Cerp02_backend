const bcrypt = require("bcrypt");

async function run() {
  const users = [
    { email: "superadmin@kasoa.gov.gh", password: "Admin@CERP2026!" },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    console.log(`${u.email} => ${hash}`);
  }
}

run();
