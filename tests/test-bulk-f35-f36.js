/**
 * tests/test-bulk-f35-f36.js
 * Verification for F-35 (type picker bubble vs empty hero) and F-36 (mobile 390px responsive styling)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running F-35 Type Picker Card Test...');

// Mock browser environment for cards.js
const mockWindow = {
  Bulk: {
    util: {
      esc: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      formatBytes: (b) => b + ' B'
    },
    config: {
      TYPES: {
        dept: { label: 'Departments', icon: 'building2', desc: 'Departments' },
        teacher: { label: 'Teachers', icon: 'teacher', desc: 'Faculty' },
        class: { label: 'Classes', icon: 'chalkboard', desc: 'Classrooms' },
        subject: { label: 'Subjects', icon: 'book-open', desc: 'Courses' },
        student: { label: 'Students', icon: 'graduation-cap', desc: 'Admissions' }
      }
    },
    api: {},
    store: { getState: () => ({}) }
  }
};
mockWindow.window = mockWindow;

const cardsCode = fs.readFileSync(path.join(__dirname, '../public/js/pages/bulk/bulk.cards.js'), 'utf8');
const vm = require('vm');
const context = vm.createContext(mockWindow);
vm.runInContext(cardsCode, context);

const typeCard = mockWindow.Bulk.cards['type'];
assert(typeCard, 'Expected type card to be registered in cards');

// 1. In conversation with active batch, type card renders as a user bubble
const userBubbleHtml = typeCard.render({ batch: { type: 'student' } });
assert(!userBubbleHtml.includes('empty-chat-hero'), 'Active chat must NOT render empty-chat-hero');
assert(!userBubbleHtml.includes('data-action="pick-type"'), 'Active chat must NOT render pick-type buttons');
assert(userBubbleHtml.includes('bubble-user-file'), 'Active chat must render bubble-user-file');
assert(userBubbleHtml.includes('Students import') || userBubbleHtml.includes('Student import'), 'Must render Students import');

const userBubbleKey = typeCard.key({ batch: { type: 'student' } });
assert.strictEqual(userBubbleKey, 'type-selected-student', 'Key should reflect chosen type');

// 2. In empty state without active batch, type card renders the hero with buttons
const emptyHeroHtml = typeCard.render({ caps: { types: {} } });
assert(emptyHeroHtml.includes('empty-chat-hero'), 'Empty state must render empty-chat-hero');
assert(emptyHeroHtml.includes('Start a Bulk Import'), 'Empty state must render Start a Bulk Import title');
assert(emptyHeroHtml.includes('data-action="pick-type"'), 'Empty state must render pick-type buttons');
console.log('  [PASS] F-35: Type card cleanly branches between conversation user bubble and empty hero');

console.log('Running F-36 Mobile Responsive CSS Test...');
const cssContent = fs.readFileSync(path.join(__dirname, '../public/css/bulk-chat.css'), 'utf8');

// 1. Verify Drive sync strip rules
assert(cssContent.includes('.drive-sync-strip'), 'bulk-chat.css must contain .drive-sync-strip');
assert(cssContent.includes('.drive-actions'), 'bulk-chat.css must contain .drive-actions');
assert(cssContent.includes('.drive-btn'), 'bulk-chat.css must contain .drive-btn');

// 2. Verify dock Send button does not get clipped (min-width: 0, flex-shrink: 0, white-space: nowrap)
assert(cssContent.includes('.chat-dock-input'), 'bulk-chat.css must contain .chat-dock-input');
assert(cssContent.includes('min-width: 0'), 'Input must have min-width: 0 to allow flexbox shrinking');
assert(cssContent.includes('white-space: nowrap'), 'Send button must prevent wrapping');

// 3. Verify mobile media query hides stepper to prevent ID badge overlap on <= 480px / 390px
assert(cssContent.includes('@media (max-width: 480px)'), 'bulk-chat.css must contain @media (max-width: 480px)');
const mobileMatch = cssContent.match(/@media\s*\(max-width:\s*480px\)[\s\S]*?\{([\s\S]*?)\n\}/);
assert(mobileMatch, 'Must find 480px media block');
const mobileBlock = mobileMatch[1];
assert(mobileBlock.includes('.chat-stepper'), 'Mobile block must target .chat-stepper');
assert(mobileBlock.includes('display: none !important'), 'Mobile block must hide .chat-stepper with display: none !important');
assert(mobileBlock.includes('.drive-sync-strip'), 'Mobile block must make .drive-sync-strip column oriented');
assert(mobileBlock.includes('.drive-actions'), 'Mobile block must size .drive-actions for mobile');
assert(mobileBlock.includes('.chat-dock'), 'Mobile block must adjust .chat-dock padding');
console.log('  [PASS] F-36: Mobile (390px) responsive rules eliminate stepper overlap, Drive clipping, and dock clipping');

console.log('All F-35 & F-36 tests passed successfully!');
