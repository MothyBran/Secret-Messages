
import os

def verify_file_content(filepath, search_strings):
    with open(filepath, 'r') as f:
        content = f.read()

    missing = []
    for s in search_strings:
        if s not in content:
            missing.append(s)

    return missing

def main():
    print("Verifying Final Polish Changes...")

    # 1. Verify app.js limit
    app_js_path = 'public/app.js'
    app_js_checks = [
        'const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB',
        'if (file.size > MAX_FILE_SIZE) { showToast("Datei ist zu groß! Maximum sind 25MB.", \'error\'); return; }'
    ]

    missing_app = verify_file_content(app_js_path, app_js_checks)
    if missing_app:
        print(f"FAILED: Missing content in {app_js_path}:")
        for m in missing_app:
            print(f"  - {m}")
    else:
        print(f"SUCCESS: {app_js_path} verified.")

    # 2. Verify ui.css scrollbar
    css_path = 'public/assets/css/ui.css'
    css_checks = [
        '.wizard-container::-webkit-scrollbar { \n    display: none; /* Chrome/Safari */\n}',
        'scrollbar-width: none; /* Firefox */'
    ]

    missing_css = verify_file_content(css_path, css_checks)
    if missing_css:
        print(f"FAILED: Missing content in {css_path}:")
        for m in missing_css:
            print(f"  - {m}")
    else:
        print(f"SUCCESS: {css_path} verified.")

if __name__ == "__main__":
    main()
