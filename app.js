// ====================================================================
// app.js (Клиентская логика)
// ====================================================================

// !!! ЗАМЕНИТЕ ЭТОТ URL НА URL ВАШЕГО РАЗВЕРНУТОГО ВЕБ-ПРИЛОЖЕНИЯ GAS !!!
const GAS_URL = 'https://script.google.com/macros/s/AKfycby0fKxYOqH57Y7YHlMeCbhF42MP-6fngk-LN1Par2czVm9Irow8UdOO8YGOfeNhUt83/exec'; 

let referenceData = {}; // Для хранения справочника Артикул: Баркод
let allDeliveries = []; // Для хранения всех загруженных карточек

document.addEventListener('DOMContentLoaded', () => {
    // 1. Загрузка данных и карточек
    loadInitialData().then(loadDeliveries); 
    
    // 2. Слушатели формы
    document.getElementById('article').addEventListener('change', updateBarcode);
    document.getElementById('deliveryForm').addEventListener('submit', handleFormSubmit);

    // 3. Слушатели фильтров
    document.querySelectorAll('#filter-options .filter-btn').forEach(button => {
        button.addEventListener('click', handleFilterClick);
    });
});

// --- API-ВЗАИМОДЕЙСТВИЕ С GAS ---

/**
 * Загружает склады и справочник Артикул/Баркод.
 */
async function loadInitialData() {
    try {
        const response = await fetch(`${GAS_URL}?action=getLists`);
        const data = await response.json();

        if (data.error) {
            console.error('Ошибка на стороне GAS:', data.error);
            alert('Ошибка загрузки данных: ' + data.error);
            return;
        }

        // 1. Заполнение Складов
        const warehouseSelect = document.getElementById('receiving_warehouse');
        warehouseSelect.innerHTML = '';
        data.warehouses.forEach(warehouse => {
            warehouseSelect.add(new Option(warehouse, warehouse));
        });

        // 2. Заполнение Артикулов и сохранение справочника
        const articleSelect = document.getElementById('article');
        articleSelect.innerHTML = '';
        referenceData = data.reference; 
        
        articleSelect.add(new Option('Выберите артикул', '', true, true));

        Object.keys(referenceData).forEach(article => {
            articleSelect.add(new Option(article, article));
        });

    } catch (error) {
        console.error('Ошибка получения данных из Apps Script:', error);
        alert('Не удалось подключиться к серверу данных. Проверьте URL и развертывание GAS.');
    }
}

/**
 * Загружает все текущие поставки.
 */
async function loadDeliveries() {
    const container = document.getElementById('cards-container');
    container.innerHTML = '<p class="loading-message">Загрузка поставок...</p>';
    
    try {
        const response = await fetch(`${GAS_URL}?action=getDeliveries`);
        const deliveries = await response.json();

        if (deliveries.error) {
            container.innerHTML = `<p class="error-message">Ошибка: ${deliveries.error}</p>`;
            return;
        }

        allDeliveries = deliveries; // Сохраняем для фильтрации
        displayDeliveries(allDeliveries);

    } catch (error) {
        console.error('Ошибка загрузки карточек:', error);
        container.innerHTML = '<p>Не удалось загрузить карточки поставок.</p>';
    }
}


// --- ЛОГИКА ФОРМЫ И ГЕНЕРАЦИЯ ---

/**
 * Автоматически заполняет поле Баркода.
 */
function updateBarcode() {
    const article = document.getElementById('article').value;
    const barcodeInput = document.getElementById('barcode');
    
    if (referenceData[article]) {
        barcodeInput.value = referenceData[article];
    } else {
        barcodeInput.value = '';
    }
}

/**
 * Обновляет цвет борта формы при выборе маркетплейса.
 */
function updateFormBorder(mp) {
    const form = document.getElementById('deliveryForm');
    form.classList.remove('mp-wb-border', 'mp-ozon-border');
    if (mp === 'WB') {
        form.classList.add('mp-wb-border');
    } else if (mp === 'OZON') {
        form.classList.add('mp-ozon-border');
    }
}

/**
 * Обрабатывает отправку формы, генерирует ШК коробов и сохраняет данные.
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = {};
    formData.forEach((value, key) => data[key] = value);

    // --- ГЕНЕРАЦИЯ ШК КОРОБОВ ---
    const numBoxes = parseInt(data.num_boxes);
    const startingCode = parseInt(data.starting_box_code);
    const boxBarcodes = [];

    for (let i = 0; i < numBoxes; i++) {
        boxBarcodes.push(`WB_${startingCode + i}`);
    }
    
    data.box_barcodes_list = boxBarcodes.join(', ');
    data.action = 'create'; 

    const submitButton = document.getElementById('submit-button');
    submitButton.disabled = true;

    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        
        if (result.success) {
            alert(result.message);
            form.reset(); 
            document.getElementById('barcode').value = ''; // Очистка readonly поля
            updateFormBorder(''); // Убрать цвет борта
            loadDeliveries(); // Обновить дашборд
        } else {
            alert("Ошибка сохранения: " + result.message);
        }

    } catch (error) {
        console.error('Ошибка сети/сервера:', error);
        alert('Ошибка при сохранении данных. Проверьте консоль.');
    } finally {
        submitButton.disabled = false;
    }
}

/**
 * Обработчик кнопки "Отправлено".
 */
async function handleMarkAsSent(rowId) {
    if (!confirm(`Вы уверены, что поставка в строке ${rowId} отправлена и должна перейти в статус "В пути"?`)) {
        return;
    }

    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'markSent', id: rowId }),
            headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadDeliveries(); // Обновить дашборд
        } else {
            alert("Ошибка: " + result.message);
        }

    } catch (error) {
        alert('Ошибка при обновлении статуса.');
    }
}


// --- ЛОГИКА ОТОБРАЖЕНИЯ И ФИЛЬТРАЦИИ ---

/**
 * Отображает карточки в контейнере.
 */
function displayDeliveries(deliveries) {
    const container = document.getElementById('cards-container');
    container.innerHTML = ''; 

    if (deliveries.length === 0) {
        container.innerHTML = '<p>Пока нет созданных поставок, соответствующих фильтру.</p>';
        return;
    }

    deliveries.forEach(delivery => {
        const card = createDeliveryCard(delivery);
        container.appendChild(card);
    });
}

/**
 * Создает HTML-элемент карточки поставки.
 */
function createDeliveryCard(delivery) {
    const card = document.createElement('div');
    const isSent = delivery.date_sent && delivery.date_sent.trim() !== '';

    // Применяем классы для подсветки!
    card.className = `delivery-card mp-${delivery.marketplace} stage-${delivery.stage}`;
    card.setAttribute('data-id', delivery.rowId); 

    card.innerHTML = `
        <div class="card-title">
            ${delivery.marketplace} — ${delivery.warehouse}
        </div>
        <div class="card-data">
            <p><strong>Артикул:</strong> ${delivery.article}</p>
            <p><strong>ШК Поставки:</strong> ${delivery.delivery_code}</p>
            <p><strong>Коробов:</strong> ${delivery.num_boxes} шт. (${delivery.units_in_box} ед/кор)</p>
            <p><strong>Дата создания:</strong> ${delivery.date_created}</p>
            <p><strong>Дата отправки:</strong> ${isSent ? delivery.date_sent : 'НЕ ОТПРАВЛЕНО'}</p>
            <p><strong>ТТН:</strong> ${delivery.ttn_number || 'Нет'}</p>
            <p class="small-text"><strong>ШК Коробов:</strong> ${delivery.box_barcodes_list.substring(0, 50)}...</p>
        </div>
        <div class="action-buttons">
            <button class="edit-btn" disabled>Редактировать</button> 
            <button class="send-btn ${isSent ? 'sent' : ''}" 
                    ${isSent ? 'disabled' : ''}
                    onclick="handleMarkAsSent(${delivery.rowId})">
                ${isSent ? 'Отправлено' : 'Отметить как Отправлено'}
            </button>
        </div>
    `;
    return card;
}

/**
 * Обрабатывает клики по кнопкам фильтрации.
 */
function handleFilterClick(e) {
    const filterValue = e.target.getAttribute('data-filter');
    
    // Обновляем активную кнопку
    document.querySelectorAll('#filter-options .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    e.target.classList.add('active');

    let filteredDeliveries = [];

    if (filterValue === 'all') {
        filteredDeliveries = allDeliveries;
    } else if (filterValue === 'WB' || filterValue === 'OZON') {
        // Фильтр по Маркетплейсу
        filteredDeliveries = allDeliveries.filter(d => d.marketplace === filterValue);
    } else {
        // Фильтр по Стадии (цвету)
        filteredDeliveries = allDeliveries.filter(d => d.stage === filterValue);
    }

    displayDeliveries(filteredDeliveries);
}