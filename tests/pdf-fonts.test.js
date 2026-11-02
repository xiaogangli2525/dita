'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {missingGlyphs,ensureCjkFonts}=require('../lib/pdf-fonts');
test('PDF font coverage checks every distinct Han character, including supplementary planes',async()=>{
 assert.deepEqual(missingGlyphs('中文中 A 𠀀','20-7e 4e2d 6587'),['𠀀']);
 assert.deepEqual(missingGlyphs('中文 𠀀','4e00-9fff 20000-2ffff'),[]);
 assert.deepEqual(missingGlyphs('中文','20-7e'),['中','文']);
 await ensureCjkFonts('English PDF');
});
