#!/usr/bin/env bash
set -euo pipefail

login_user=$1
home=$(getent passwd "$login_user" | cut -d: -f6)

as_user() { runuser -u "$login_user" -- env HOME="$home" PATH="/usr/local/bin:/usr/bin:/bin" "$@"; }

apt_get() {
    DEBIAN_FRONTEND=noninteractive apt-get -y -qq \
        -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confold "$@" </dev/null
}

apt_get update
apt_get install vim golang-go clangd clang-format fzf ripgrep bear gdb git

as_user go install golang.org/x/tools/gopls@latest
as_user go install github.com/go-delve/delve/cmd/dlv@latest
cat >/etc/profile.d/go-bin.sh <<'EOF'
case ":$PATH:" in *":$HOME/go/bin:"*) ;; *) PATH="$PATH:$HOME/go/bin" ;; esac
EOF

pack="$home/.vim/pack/kernschild/start"
as_user mkdir -p "$pack" "$home/.vim/undo" "$home/.config/clangd"
for repo in \
    preservim/nerdtree \
    yegappan/lsp \
    junegunn/fzf.vim \
    tpope/vim-fugitive \
    airblade/vim-gitgutter \
    tpope/vim-commentary \
    tpope/vim-surround \
    itchyny/lightline.vim; do
    dest="$pack/${repo#*/}"
    if [ -d "$dest/.git" ]; then
        as_user git -C "$dest" pull -q --ff-only
    else
        as_user git clone -q --depth 1 "https://github.com/${repo}.git" "$dest"
    fi
    if [ -d "$dest/doc" ]; then
        as_user vim -es -N -u NONE -i NONE -c "helptags $dest/doc" -c 'qa!'
    fi
done

cat >"$home/.config/clangd/config.yaml" <<'EOF'
If:
  PathMatch: .*\.bpf\.(c|h)
CompileFlags:
  Add: [--target=bpf, -D__TARGET_ARCH_x86, -I/usr/include/x86_64-linux-gnu]
EOF

cat >"$home/.vim/kernschild.vim" <<'EOF'
" Managed by Terraform (vim.sh) and overwritten on re-provision; put your own settings in ~/.vimrc.
set nocompatible
filetype plugin indent on
syntax on
set encoding=utf-8 hidden mouse=a updatetime=300
set number relativenumber cursorline signcolumn=yes
set incsearch hlsearch ignorecase smartcase
set splitright splitbelow scrolloff=5
set wildmenu wildmode=longest:full,full
set laststatus=2 noshowmode backspace=indent,eol,start
set completeopt=menuone,noinsert,noselect,popup
set undofile undodir=~/.vim/undo//
if has('termguicolors') && $COLORTERM =~# 'truecolor\|24bit'
    set termguicolors
endif
silent! colorscheme habamax
let g:lightline = {'colorscheme': 'one'}

packadd! editorconfig
packadd! termdebug
set runtimepath+=/usr/share/doc/fzf/examples

let mapleader = ' '
let g:NERDTreeShowHidden = 1
let g:NERDTreeIgnore = ['\.git$', '\.o$', '\.ko$']
nnoremap <leader>e <Cmd>NERDTreeToggle<CR>
nnoremap <leader>E <Cmd>NERDTreeFind<CR>
nnoremap <leader>f <Cmd>Files<CR>
nnoremap <leader>/ <Cmd>Rg<CR>
nnoremap <leader>b <Cmd>Buffers<CR>
nnoremap <leader>g <Cmd>Git<CR>
nnoremap <leader>h <Cmd>nohlsearch<CR>
autocmd BufEnter * if winnr('$') == 1 && exists('b:NERDTree') && b:NERDTree.isTabTree() | quit | endif

inoremap <expr> <Tab>   pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
inoremap <expr> <CR>    pumvisible() && complete_info(['selected']).selected != -1 ? "\<C-y>" : "\<CR>"

let g:kernschild_lsp_servers = [
    \ #{name: 'gopls', filetype: ['go', 'gomod', 'gowork'], path: expand('~/go/bin/gopls'), args: ['serve']},
    \ #{name: 'clangd', filetype: ['c', 'cpp'], path: 'clangd', args: ['--background-index', '--clang-tidy', '--header-insertion=never']},
    \ ]
autocmd User LspSetup call LspOptionsSet(#{
    \ autoComplete: v:true, omniComplete: v:true, completionMatcher: 'fuzzy', autoHighlightDiags: v:true,
    \ showDiagWithVirtualText: v:true, showSignature: v:true, usePopupInCodeAction: v:true,
    \ ignoreMissingServer: v:true})
autocmd User LspSetup call LspAddServer(g:kernschild_lsp_servers)

function! s:LspMappings() abort
    nnoremap <buffer> <silent> gd <Cmd>LspGotoDefinition<CR>
    nnoremap <buffer> <silent> gD <Cmd>LspGotoDeclaration<CR>
    nnoremap <buffer> <silent> gi <Cmd>LspGotoImpl<CR>
    nnoremap <buffer> <silent> gr <Cmd>LspShowReferences<CR>
    nnoremap <buffer> <silent> K  <Cmd>LspHover<CR>
    nnoremap <buffer> <silent> [d <Cmd>LspDiag prev<CR>
    nnoremap <buffer> <silent> ]d <Cmd>LspDiag next<CR>
    nnoremap <buffer> <silent> <leader>d  <Cmd>LspDiag show<CR>
    nnoremap <buffer> <silent> <leader>rn <Cmd>LspRename<CR>
    nnoremap <buffer> <silent> <leader>ca <Cmd>LspCodeAction<CR>
    nnoremap <buffer> <silent> <leader>F  <Cmd>LspFormat<CR>
    nnoremap <buffer> <silent> <leader>o  <Cmd>LspOutline<CR>
    nnoremap <buffer> <silent> <leader>s  <Cmd>LspSwitchSourceHeader<CR>
endfunction
autocmd User LspAttached call s:LspMappings()
autocmd FileType go setlocal noexpandtab tabstop=4 shiftwidth=4
autocmd BufWritePre *.go silent! LspFormat
EOF

if [ ! -f "$home/.vimrc" ]; then
    printf 'source ~/.vim/kernschild.vim\n' >"$home/.vimrc"
fi
chown "$login_user:$login_user" "$home/.vimrc" "$home/.vim/kernschild.vim" "$home/.config/clangd/config.yaml"

as_user vim -es -N -i NONE -u "$home/.vimrc" \
    -c 'if exists(":NERDTree") && exists(":LspHover") && exists(":Files") && exists(":Git") | qa! | else | cq! | endif'

echo "vim:    $(vim --version | head -1)"
echo "go:     $(go version)"
echo "gopls:  $(as_user "$home/go/bin/gopls" version | head -1)"
echo "dlv:    $(as_user "$home/go/bin/dlv" version | sed -n 's/^Version: //p')"
echo "clangd: $(clangd --version | head -1)"
