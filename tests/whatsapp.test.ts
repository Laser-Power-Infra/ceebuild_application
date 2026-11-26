import { test } from 'node:test';
import assert from 'node:assert/strict';

test('WhatsApp numbers: Indian mobiles get 91, groups kept, junk refused', async () => {
  const { waNumber, waText } = await import('../src/lib/whatsappText');
  assert.equal(waNumber('88200 44755'), '918820044755');
  assert.equal(waNumber('+91 88200-44755'), '918820044755');
  assert.equal(waNumber('08820044755'), '918820044755');
  assert.equal(waNumber('120363295648424210@g.us'), '120363295648424210@g.us');
  assert.equal(waNumber('12345'), null);
  assert.ok(waText('x'.repeat(5000)).length < 4000);
});
