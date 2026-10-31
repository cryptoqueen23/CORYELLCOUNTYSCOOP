#!/bin/bash
# usage: gate2.sh N file1 file2 ... -> waits until N fetching runs are recorded across the (merged) tails
S=/c/Users/insur/AppData/Local/Temp/claude/C--Users-insur/c3bfdea8-b729-49b9-9fdb-7789d88310e0/scratchpad
cd $S
N=$1; shift; F=$(IFS=,; echo "$*")
until [ "$(node variant.cjs x $F | sed -n 1p | sed 's/.*: \([0-9]*\) fetching runs.*/\1/')" -ge $N ]; do sleep 60; done
node variant.cjs final $F
