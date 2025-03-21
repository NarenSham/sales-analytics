const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'your_database',
    password: process.env.DB_PASSWORD || 'your_password',
    port: process.env.DB_PORT || 5432,
});

module.exports = pool;

async function loadData() {
    const filePath = path.join(__dirname, 'data.csv');
    const query = `
        COPY sales(id, amount, date)
        FROM '${filePath}'
        DELIMITER ','
        CSV HEADER;
    `;

    try {
        await pool.query(query);
        console.log('Data loaded successfully');
    } catch (error) {
        console.error('Error loading data:', error);
    } finally {
        await pool.end();
    }
}

loadData(); 