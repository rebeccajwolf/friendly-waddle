#!/bin/bash

set -e


cd /home/user/app


nohup gunicorn keep_alive:app --bind 0.0.0.0:7860 &

bash start.sh
