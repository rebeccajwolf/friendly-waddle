from flask import Flask
import datetime
import sys
import os

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

app = Flask(__name__)

@app.route('/')
def home():
    print(f"[{datetime.datetime.now()}] Health check ping", flush=True)
    return "Bot is running"

@app.route('/health')
def health():
    return "OK", 200

if __name__ == "__main__":
    print(f"[{datetime.datetime.now()}] 🚀 Keep alive server starting on port 7860", flush=True)
    print(f"[{datetime.datetime.now()}] Python version: {sys.version}", flush=True)
    print(f"[{datetime.datetime.now()}] Working directory: {os.getcwd()}", flush=True)
    app.run(host='0.0.0.0', port=7860, debug=False)