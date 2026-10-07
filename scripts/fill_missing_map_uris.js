const fs = require('fs');
const path = require('path');

const mockFile = path.join(__dirname, '..', 'data', 'mock_restaurants.json');
const mock = JSON.parse(fs.readFileSync(mockFile, 'utf8'));

let fixed = 0;
mock.forEach(r => {
    if (!r.googleMapsUri) {
        if (r.latitude && r.longitude) {
            r.googleMapsUri = 'https://www.google.com/maps/search/?api=1&query=' + r.latitude + ',' + r.longitude;
        } else {
            r.googleMapsUri = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.name + ' ' + (r.address || ''));
        }
        fixed++;
    }
});

fs.writeFileSync(mockFile, JSON.stringify(mock, null, 2), 'utf8');
console.log('Fixed missing googleMapsUri count:', fixed);
