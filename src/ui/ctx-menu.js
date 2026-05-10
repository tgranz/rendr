class CtxMenu {
	static activeMenu = null;
	static animationDurationMs = 140;

	constructor(anchorElement, items, options = {}) {
		if (!(anchorElement instanceof HTMLElement)) {
			throw new Error('CtxMenu expected an HTMLElement as the first argument.');
		}

		if (!Array.isArray(items)) {
			throw new Error('CtxMenu expected an array of menu item objects as the second argument.');
		}

		this.anchorElement = anchorElement;
		this.items = items;
		this.options = {
			align: 'left',
			offsetX: 0,
			offsetY: 4,
			closeOnSelect: true,
			position: null,
			...options
		};

		this.menuElement = this.buildMenuElement();
		document.body.appendChild(this.menuElement);

		this.onDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
		this.onDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
		this.onWindowResize = this.positionMenu.bind(this);
		this.onWindowScroll = this.positionMenu.bind(this);
		this.isClosing = false;

		this.show();
	}

	static fromEvent(event, items, options = {}) {
		if (event && typeof event.preventDefault === 'function') {
			event.preventDefault();
		}

		const fallbackAnchor = document.body;
		const eventTarget = event && event.currentTarget instanceof HTMLElement
			? event.currentTarget
			: fallbackAnchor;

		return new CtxMenu(eventTarget, items, {
			...options,
			position: {
				x: event.clientX,
				y: event.clientY
			}
		});
	}

	buildMenuElement() {
		const menu = document.createElement('div');
		menu.className = 'ctx-menu';
		menu.setAttribute('role', 'menu');

		const list = document.createElement('ul');
		list.className = 'ctx-menu__list';

		for (const item of this.items) {
			if (item && item.separator) {
				const separator = document.createElement('li');
				separator.className = 'ctx-menu__separator';
				separator.setAttribute('role', 'separator');
				list.appendChild(separator);
				continue;
			}

			const listItem = document.createElement('li');
			listItem.className = 'ctx-menu__item';

			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'ctx-menu__button';
			button.setAttribute('role', 'menuitem');

			if (item && item.danger) {
				button.classList.add('ctx-menu__button--danger');
			}

			if (!item || item.disabled) {
				button.disabled = true;
			}

			const left = document.createElement('span');
			left.className = 'ctx-menu__left';

			if (item && item.iconClass) {
				const icon = document.createElement('i');
				icon.className = `ctx-menu__icon ${item.iconClass}`;
				left.appendChild(icon);
			}

			const label = document.createElement('span');
			label.className = 'ctx-menu__label';
			label.textContent = item && item.label ? item.label : '';
			left.appendChild(label);

			const shortcut = document.createElement('span');
			shortcut.className = 'ctx-menu__shortcut mono';
			shortcut.textContent = item && item.shortcut ? item.shortcut : '';

			button.appendChild(left);
			button.appendChild(shortcut);

			button.addEventListener('click', (event) => {
				if (!item || item.disabled) {
					return;
				}

				const callback = item.onClick || item.callback;
				if (typeof callback === 'function') {
					callback({
						menu: this,
						anchorElement: this.anchorElement,
						item,
						event
					});
				}

				if (this.options.closeOnSelect && !item.keepOpen) {
					this.close();
				}
			});

			listItem.appendChild(button);
			list.appendChild(listItem);
		}

		menu.appendChild(list);
		return menu;
	}

	show() {
		if (CtxMenu.activeMenu && CtxMenu.activeMenu !== this) {
			CtxMenu.activeMenu.close();
		}

		CtxMenu.activeMenu = this;
		this.menuElement.classList.remove('ctx-menu--closing');
		this.menuElement.classList.add('ctx-menu--open');
		this.positionMenu();

		// Delay outside-click binding so the click that opened the menu does not close it immediately.
		window.setTimeout(() => {
			document.addEventListener('pointerdown', this.onDocumentPointerDown);
			document.addEventListener('keydown', this.onDocumentKeyDown);
			window.addEventListener('resize', this.onWindowResize);
			window.addEventListener('scroll', this.onWindowScroll, true);
		}, 0);
	}

	showAtElement(element, options = {}) {
		if (!(element instanceof HTMLElement)) {
			return;
		}

		this.anchorElement = element;
		this.options = {
			...this.options,
			...options,
			position: null
		};

		this.positionMenu();
	}

	positionMenu() {
		const rect = this.menuElement.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		let x;
		let y;

		if (this.options.position && typeof this.options.position.x === 'number' && typeof this.options.position.y === 'number') {
			x = this.options.position.x + this.options.offsetX;
			y = this.options.position.y + this.options.offsetY;
		} else {
			const anchorRect = this.anchorElement.getBoundingClientRect();
			x = this.options.align === 'right'
				? anchorRect.right - rect.width + this.options.offsetX
				: anchorRect.left + this.options.offsetX;
			y = anchorRect.bottom + this.options.offsetY;
		}

		const margin = 8;
		const maxX = viewportWidth - rect.width - margin;
		const maxY = viewportHeight - rect.height - margin;

		x = Math.max(margin, Math.min(x, maxX));
		y = Math.max(margin, Math.min(y, maxY));

		this.menuElement.style.left = `${x}px`;
		this.menuElement.style.top = `${y}px`;
	}

	handleDocumentPointerDown(event) {
		const clickedInsideMenu = this.menuElement.contains(event.target);
		const clickedAnchor = this.anchorElement.contains(event.target);

		if (!clickedInsideMenu && !clickedAnchor) {
			this.close();
		}
	}

	handleDocumentKeyDown(event) {
		if (event.key === 'Escape') {
			this.close();
		}
	}

	close() {
		if (this.isClosing) {
			return;
		}

		this.isClosing = true;
		document.removeEventListener('pointerdown', this.onDocumentPointerDown);
		document.removeEventListener('keydown', this.onDocumentKeyDown);
		window.removeEventListener('resize', this.onWindowResize);
		window.removeEventListener('scroll', this.onWindowScroll, true);
		this.menuElement.classList.remove('ctx-menu--open');
		this.menuElement.classList.add('ctx-menu--closing');

		window.setTimeout(() => {
			if (this.menuElement && this.menuElement.parentElement) {
				this.menuElement.parentElement.removeChild(this.menuElement);
			}
		}, CtxMenu.animationDurationMs);

		if (CtxMenu.activeMenu === this) {
			CtxMenu.activeMenu = null;
		}
	}
}

window.CtxMenu = CtxMenu;
export default CtxMenu;
