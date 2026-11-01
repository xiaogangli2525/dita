'use strict';
// Shared user gestures for panels that are now opened on demand. Assertions
// about the shell itself stay explicit in shell-browser.test.js.
async function openNotes(page) {
  if (!await page.locator('#footnotesPanel').isVisible()) await page.click('#footnotesButton');
}
async function openProperties(page) {
  if (!await page.locator('#attributesPanel').isVisible()) await page.click('#inspectorToggleButton');
}
async function openAdvancedProperties(page) {
  await openProperties(page);
  if (!await page.locator('#advancedAttributes').evaluate(node => node.open)) await page.click('#advancedAttributes > summary');
}
async function closePanel(page) {
  if (await page.locator('#inspector').isVisible()) await page.click('#inspectorCloseButton');
}
async function newDocument(page) {
  if (!await page.locator('#newDocumentButton').isVisible()) await page.click('#sidebarToggleButton');
  await page.click('#newDocumentButton');
}
module.exports = { openNotes, openProperties, openAdvancedProperties, closePanel, newDocument };
