class Modal {
    constructor(title, htmlContent) {
        this.title = title;
        this.htmlContent = htmlContent;
        this.isOpen = false;

        this.createModal();
        this.attachEventListeners();
    }

    createModal() {
        // Create darkener/backdrop
        this.darkener = document.createElement('div');
        this.darkener.className = 'modal-darkener';

        // Create modal container
        this.modalContainer = document.createElement('div');
        this.modalContainer.className = 'modal';

        // Create modal header
        const header = document.createElement('div');
        header.className = 'modal-header';

        const titleElement = document.createElement('h2');
        titleElement.className = 'modal-title';
        titleElement.textContent = this.title;

        const closeButton = document.createElement('button');
        closeButton.className = 'modal-close';
        closeButton.innerHTML = '<i class="ti ti-x"></i>';
        closeButton.addEventListener('click', () => this.close());

        header.appendChild(titleElement);
        header.appendChild(closeButton);

        // Create modal content
        const content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = this.htmlContent;

        // Assemble modal
        this.modalContainer.appendChild(header);
        this.modalContainer.appendChild(content);

        // Assemble and append to body
        this.darkener.appendChild(this.modalContainer);
    }

    attachEventListeners() {
        // Close on darkener click
        this.darkener.addEventListener('click', (e) => {
            if (e.target === this.darkener) {
                this.close();
            }
        });

        // Close on escape key
        this.escapeHandler = (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        };
    }

    open() {
        if (this.isOpen) return;

        document.body.appendChild(this.darkener);

        // Trigger reflow to enable animation
        void this.darkener.offsetHeight;

        this.darkener.classList.add('open');
        this.modalContainer.classList.add('open');

        this.isOpen = true;
        document.addEventListener('keydown', this.escapeHandler);
    }

    close() {
        if (!this.isOpen) return;

        this.darkener.classList.remove('open');
        this.modalContainer.classList.remove('open');

        this.isOpen = false;
        document.removeEventListener('keydown', this.escapeHandler);

        // Remove from DOM after animation completes
        setTimeout(() => {
            if (this.darkener.parentNode) {
                this.darkener.parentNode.removeChild(this.darkener);
            }
        }, 150);
    }
}

export default Modal;
