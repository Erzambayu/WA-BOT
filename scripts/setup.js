const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up WhatsApp Bot...');

// Direktori yang perlu dibuat
const directories = [
    'config',
    'data', 
    'logs',
    'baileys_auth',
    'backup',
    'media',
    'temp'
];

// File konfigurasi default
const defaultConfigs = {
    'config/admins.json': [],
    'config/birthdays.json': [],
    'config/scheduled_messages.json': [],
    'config/maintenance.json': {
        enabled: false,
        message: 'Bot sedang dalam maintenance'
    },
    'config/bot_stats.json': {
        startTime: 0,
        messagesSent: 0,
        commandsExecuted: 0,
        errors: 0
    },
    'config/bot_status.json': {
        online: false,
        lastSeen: 0
    },
    'config/blacklist.json': [],
    'config/finance.json': {
        hutang: [],
        expenses: []
    },
    'config/invoices.json': [],
    'config/expenses.json': [],
    'config/url_shortener.json': {},
    'config/user_ai_memory.json': {},
    'config/last_target.json': {
        target: null,
        timestamp: 0
    },
    'config/sholat_city.json': {
        city: 'jakarta'
    }
};

function createDirectories() {
    console.log('📁 Creating directories...');
    
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`✅ Created: ${dir}/`);
        } else {
            console.log(`⏭️  Exists: ${dir}/`);
        }
    });
}

function createConfigFiles() {
    console.log('📄 Creating configuration files...');
    
    Object.entries(defaultConfigs).forEach(([filePath, content]) => {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
            console.log(`✅ Created: ${filePath}`);
        } else {
            console.log(`⏭️  Exists: ${filePath}`);
        }
    });
}

function checkEnvironmentFile() {
    console.log('🔐 Checking environment file...');
    
    if (!fs.existsSync('.env')) {
        if (fs.existsSync('env.example')) {
            fs.copyFileSync('env.example', '.env');
            console.log('✅ Created .env from env.example');
            console.log('⚠️  IMPORTANT: Please edit .env file and add your API keys!');
        } else {
            console.log('❌ env.example not found. Please create .env manually.');
        }
    } else {
        console.log('⏭️  .env file already exists');
    }
}

function displayNextSteps() {
    console.log('\n🎉 Setup completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Edit .env file and add your API keys');
    console.log('   - GEMINI_API_KEY (required)');
    console.log('   - DEEPSEEK_API_KEY (required)');
    console.log('   - OPENWEATHER_API_KEY (required)');
    console.log('   - OWNER_NUMBER (your WhatsApp number)');
    console.log('2. Run: npm start');
    console.log('3. Scan QR code with WhatsApp');
    console.log('\n✨ Happy coding!');
}

// Main setup
try {
    createDirectories();
    createConfigFiles(); 
    checkEnvironmentFile();
    displayNextSteps();
} catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
} 