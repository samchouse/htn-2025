{
  lib,
  pkgs,
  ...
}:
let
  wsCaddyConfig = ''
    {
      admin off
    }

    :6747 {
      rewrite * /{$SLUG}{uri}
      reverse_proxy localhost:3002
    }
  '';
in
{
  cachix.enable = false;
  dotenv.disableHint = true;

  packages = with pkgs; [
    git
    caddy
    podman
    flyctl
    stripe-cli
    cloudflared
    graphite-cli
    google-cloud-sdk
  ];
  env.TESSDATA_PREFIX = "${pkgs.tesseract}/share/tessdata";
  env.LD_LIBRARY_PATH = lib.makeLibraryPath (
    with pkgs;
    [
      zlib
      file
    ]
  );

  # Feature flags
  env.ENABLE_ANNOTATED_PDF = "false"; # Set to "true" to enable annotated PDF creation for testing

  languages = {
    deno.enable = true;
    javascript = {
      enable = true;
      package = pkgs.nodejs-slim_24;

      npm.enable = true;
      bun.enable = true;
      pnpm = {
        enable = true;
        package = pkgs.pnpm;
        install.enable = true;
      };
    };
    python = {
      enable = true;
      package = pkgs.python312;

      directory = "packages/api";
      uv = {
        enable = true;
        # sync.enable = true;
      };
    };
  };

  services = {
    typesense = {
      enable = true;
      apiKey = "xyz";
      port = 8109;
    };
    caddy = {
      enable = true;
      config = ''
        {
          admin off
        }

        :6746 {
          @supabase path_regexp supabase ^/supabase(/.*)?$
          handle @supabase {
            rewrite * {re.supabase.1}
            reverse_proxy localhost:54321
          }

          @ws_excel {
            path_regexp ws_excel ^/excel(/.*)?$
            header Connection *Upgrade*
            header Upgrade websocket
          }
          handle @ws_excel {
            rewrite * /excel{re.ws_excel.1}
            reverse_proxy localhost:6747
          }

          reverse_proxy localhost:3000 {
            header_up Host dev.coalesc.xyz
          }
        }
      '';
    };
  };

  processes = {
    web = {
      exec = "cd packages/web && infisical run --watch --path=/web -- pnpm dev";
    };
    api = {
      exec = "cd packages/api && infisical run --watch --path=/api -- fastapi dev src/main.py";
    };
    excel = {
      exec = "cd packages/excel && infisical run --watch --path=/excel -- pnpm dev";
    };
    supabase = {
      exec = "infisical export --path=/functions > packages/supabase/functions/.env && sb start && sb functions serve";
      process-compose = {
        disabled = false;
        shutdown = {
          command = "sb stop";
        };
      };
    };
    stripe = {
      exec = "stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe";
    };
    cloudflared = {
      exec = "infisical run --watch -- sh -c 'cloudflared tunnel run --token $CLOUDFLARED_TOKEN'";
    };
    ws-caddy = {
      exec = "echo '${wsCaddyConfig}' | caddy run --adapter caddyfile --config -";
    };
  };

  scripts = {
    sb.exec = ''
      pnpm supabase --workdir packages "$@";
    '';
    infisical.exec = ''
      pnpm -s dlx @infisical/cli@latest "$@";
    '';
    claude.exec = ''
      pnpm -s dlx @anthropic-ai/claude-code@latest "$@";
    '';
    init.exec = ''
      set() {
        infisical secrets set --type=personal $@
      }

      read -p "Enter your Cloudflare Tunnel slug: " CLOUDFLARED_SLUG
      read -p "Enter your Cloudflare Tunnel token: " CLOUDFLARED_TOKEN

      DEV_URL="https://dev.coalesc.xyz/$CLOUDFLARED_SLUG"

      set CLOUDFLARED_TOKEN=$CLOUDFLARED_TOKEN
      set --path=/excel VITE_URL=$DEV_URL VITE_SUPABASE_URL=$DEV_URL/supabase
      set --path=/web NEXT_PUBLIC_URL=$DEV_URL NEXT_PUBLIC_SUPABASE_URL=$DEV_URL/supabase

      echo $CLOUDFLARED_SLUG > .devenv/state/initialized
      echo "Environment initialized."
    '';
    test.exec = ''
      echo "Starting development environment with annotated PDF creation enabled..."
      echo "ENABLE_ANNOTATED_PDF=true"
      ENABLE_ANNOTATED_PDF=true devenv up
    '';
  };

  enterShell = ''
    source .devenv/state/venv/bin/activate
    if ! (command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1); then
      export DOCKER_HOST=$(uname | grep -qi darwin && echo "unix:///var/run/docker.sock" || echo "unix:///run/user/$(id -u)/podman/podman.sock")
    fi

    if [ ! -f .devenv/state/initialized ]; then
      COLS=$(tput cols 2>/dev/null || echo 80)
      BOX_WIDTH=60
      PADDING=$(( (COLS - BOX_WIDTH) / 2 ))
      PAD=$(printf "%*s" ''${PADDING} "")
      
      echo
      echo
      echo -e "\033[38;5;124m\033[1m"
      echo "''${PAD}╔════════════════════════════════════════════════════════╗"
      echo "''${PAD}║                                                        ║"
      echo "''${PAD}║              Environment not initialized!              ║"
      echo "''${PAD}║                                                        ║"
      echo "''${PAD}║          Run 'init' to set up the environment.         ║"
      echo "''${PAD}║                                                        ║"
      echo "''${PAD}╚════════════════════════════════════════════════════════╝"
      echo -e "\033[0m"
      echo
      echo
    else
      export SLUG=$(cat .devenv/state/initialized 2>/dev/null || echo "")
    fi
  '';

  git-hooks.hooks = {
    ruff.enable = true;
    ruff-format.enable = true;
    biome = {
      enable = true;
      entry = "pnpm check:fix";
      # Only run on staged files to avoid conflicts
      stages = [ "pre-commit" ];
      # Pass filenames to biome for better performance
      pass_filenames = true;
      # Don't fail if no files match
      always_run = false;
    };
    tsc = {
      enable = true;
      entry = "pnpm --filter @coalesc/web --filter @coalesc/excel check";
      # Only run on staged files to avoid conflicts
      stages = [ "pre-commit" ];
      # Pass filenames to tsc for better performance
      pass_filenames = false;
      types_or = [
        "ts"
        "tsx"
        "javascript"
        "jsx"
      ];
    };
  };
}
