#!/usr/bin/env node

const path = require('path');
const DatabaseMigration = require('../modules/database_migration');

async function main() {
    console.log('🚀 Starting WhatsApp Bot Database Migration...\n');
    
    const migration = new DatabaseMigration();
    
    try {
        // Run full migration
        const success = await migration.runFullMigration();
        
        if (success) {
            console.log('\n✅ Migration completed successfully!');
            console.log('📁 JSON backup files have been created in the backup directory');
            console.log('🗄️  All data is now stored in SQLite database (bot_data.db)');
            console.log('\n📋 Next steps:');
            console.log('1. Restart your bot to use the new database system');
            console.log('2. Verify that all features are working correctly');
            console.log('3. You can safely delete the JSON files after verification');
        } else {
            console.log('\n❌ Migration failed! Check the logs above for details.');
            console.log('🔄 You can safely run this script again to retry the migration.');
        }
    } catch (error) {
        console.error('\n💥 Unexpected error during migration:', error.message);
        console.error(error.stack);
    } finally {
        migration.close();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = main; 