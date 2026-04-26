<!-- taskmux:start -->

# Taskmux — oddjob

## Tasks

_No tasks configured yet. Use `taskmux add <name> "<command>"` to add._

## Usage

```bash
taskmux start              # Start all auto_start tasks
taskmux stop               # Stop all tasks
taskmux stop <task>        # Graceful stop (C-c) a single task
taskmux start <task>       # Start a single task
taskmux restart <task>     # Restart a single task
taskmux logs <task>        # Show recent logs
taskmux logs <task> --grep "error"  # Search logs
taskmux inspect <task>     # JSON task state
taskmux status             # Session overview
```

Always use taskmux to manage long-running processes instead of running them directly.

<!-- taskmux:end -->
