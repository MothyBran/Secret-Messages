// Node script to test CSV logic
// Since the functions are inside a module/app logic, I'll copy the relevant logic here to test it.

// Helper to escape fields
const escapeCsvField = (field) => {
    let val = String(field || "");
    // Prevent CSV Injection
    if (/^[=+\-@]/.test(val)) {
        val = "'" + val;
    }
    // Escape double quotes by doubling them
    val = val.replace(/"/g, '""');
    // Wrap in quotes if it contains comma, newline or quotes
    if (val.search(/("|,|\n)/g) >= 0) {
        val = `"${val}"`;
    }
    return val;
};

// Robust CSV Parsing handling quotes
const parseCsvLine = (line) => {
    const result = [];
    let start = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
            inQuotes = !inQuotes;
        } else if (line[i] === ',' && !inQuotes) {
            let field = line.substring(start, i);
            // Remove surrounding quotes and unescape double quotes
            if (field.startsWith('"') && field.endsWith('"')) {
                field = field.slice(1, -1).replace(/""/g, '"');
            }
            result.push(field);
            start = i + 1;
        }
    }
    // Push last field
    let lastField = line.substring(start);
    if (lastField.startsWith('"') && lastField.endsWith('"')) {
        lastField = lastField.slice(1, -1).replace(/""/g, '"');
    }
    result.push(lastField);
    return result;
};

// Test Cases
const contacts = [
    { id: '1001', name: 'John Doe', group: 'Work' },
    { id: 2002, name: 'Jane, Smith', group: 'Friends' }, // Numeric ID, Comma in Name
    { id: '3003', name: 'Dr. "Evil"', group: 'Enemies' }, // Quotes
    { id: '4004', name: '=Cmd', group: 'Test' } // Injection
];

console.log("--- EXPORT TEST ---");
let csvContent = "ID,Name,Group\n";
contacts.forEach(c => {
    const id = escapeCsvField(c.id);
    const name = escapeCsvField(c.name);
    const grp = escapeCsvField(c.group);
    csvContent += `${id},${name},${grp}\n`;
    console.log(`Row: ${id},${name},${grp}`);
});
console.log("\nGenerated CSV:\n" + csvContent);

console.log("\n--- IMPORT TEST ---");
const lines = csvContent.split('\n');
let importedData = [];
for (let i = 1; i < lines.length; i++) { // Skip header
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCsvLine(line);
    if (parts.length >= 1) {
        const id = parts[0].trim();
        if(id) {
            const name = parts.length > 1 ? parts[1].trim() : id;
            const group = parts.length > 2 ? parts[2].trim() : "";
            importedData.push({ id, name, group });
        }
    }
}

console.log("Imported Data:");
console.log(importedData);

// Verification assertions
if (importedData.length !== 4) console.error("FAIL: Expected 4 contacts");
if (importedData[1].name !== "Jane, Smith") console.error("FAIL: Comma handling failed");
if (importedData[2].name !== 'Dr. "Evil"') console.error("FAIL: Quote handling failed");
if (importedData[3].name !== "'=Cmd") console.error("FAIL: Injection handling failed (expected escaped)");
if (importedData[0].id !== "1001") console.error("FAIL: ID mismatch");

console.log("Done.");
