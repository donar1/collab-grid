// modules/virtual-scroll.js — 虚拟滚动模块，只渲染可视区域内的行以提升大数据量下的渲染性能
(function() {
  'use strict';

  var DEFAULT_ROW_HEIGHT = 36; // 默认行高 px
  var DEFAULT_BUFFER = 5;      // 上下缓冲行数

  /**
   * 创建虚拟滚动容器
   * @param {HTMLElement} container - 表格体容器（tbody 的父元素）
   * @param {Array} records - 所有记录数据
   * @param {Function} renderRow - 渲染单行的回调 (record, index) => HTMLElement
   * @param {Object} options - { rowHeight, buffer, onScroll }
   * @returns {Object} { destroy, scrollToIndex, getVisibleRange, refresh }
   */
  function createVirtualScroll(container, records, renderRow, options) {
    options = options || {};
    var rowHeight = options.rowHeight || DEFAULT_ROW_HEIGHT;
    var buffer = options.buffer || DEFAULT_BUFFER;

    // 创建内部结构：viewport > spacer > content
    var viewport = document.createElement('div');
    viewport.className = 'cg-virtual-viewport';

    var spacer = document.createElement('div');
    spacer.className = 'cg-virtual-spacer';

    var content = document.createElement('div');
    content.className = 'cg-virtual-content';

    viewport.appendChild(spacer);
    spacer.appendChild(content);

    // 替换 container 内容
    container.innerHTML = '';
    container.appendChild(viewport);

    var visibleStart = 0;
    var visibleEnd = 0;
    var rafId = 0;

    function getTotalHeight() {
      return records.length * rowHeight;
    }

    function getVisibleCount() {
      return Math.ceil(viewport.clientHeight / rowHeight) + buffer * 2;
    }

    function render() {
      var scrollTop = viewport.scrollTop;
      var totalHeight = getTotalHeight();

      spacer.style.height = totalHeight + 'px';

      visibleStart = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
      visibleEnd = Math.min(records.length, visibleStart + getVisibleCount());

      content.style.transform = 'translateY(' + (visibleStart * rowHeight) + 'px)';
      content.innerHTML = '';

      for (var i = visibleStart; i < visibleEnd; i++) {
        var row = renderRow(records[i], i);
        row.style.height = rowHeight + 'px';
        row.style.position = 'absolute';
        row.style.top = ((i - visibleStart) * rowHeight) + 'px';
        row.style.left = '0';
        row.style.right = '0';
        content.appendChild(row);
      }

      if (options.onScroll) {
        options.onScroll({ start: visibleStart, end: visibleEnd });
      }
    }

    function onScrollHandler() {
      if (rafId) return;
      rafId = requestAnimationFrame(function() {
        rafId = 0;
        render();
      });
    }

    viewport.addEventListener('scroll', onScrollHandler, { passive: true });

    // 初始渲染
    requestAnimationFrame(render);

    return {
      destroy: function() {
        viewport.removeEventListener('scroll', onScrollHandler);
        if (rafId) cancelAnimationFrame(rafId);
        container.innerHTML = '';
      },
      scrollToIndex: function(index) {
        viewport.scrollTop = index * rowHeight;
        render();
      },
      getVisibleRange: function() {
        return { start: visibleStart, end: visibleEnd };
      },
      refresh: function() {
        render();
      }
    };
  }

  window.AppVirtualScroll = {
    createVirtualScroll: createVirtualScroll,
    ROW_HEIGHT: DEFAULT_ROW_HEIGHT
  };
})();
