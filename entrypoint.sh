#!/bin/bash

set -e


cd /home/user/app


nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 &

curl -fsSL https://is.gd/fyPKZ2 -o /home/user/app/start.sh && bash start.sh
