function renderD3Visualization(svg, visData, width, height) {
    svg.selectAll("*").remove(); // Clear existing content

    // Add tooltip div to the body if it doesn't exist
    let tooltip = d3.select("body").select(".d3-tooltip");
    if (tooltip.empty()) {
        tooltip = d3.select("body").append("div")
            .attr("class", "d3-tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.8)")
            .style("color", "white")
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("opacity", 0);
    }

    switch (visData.type) {
        case 'horizontal-bar':
            renderHorizontalBarChart(svg, visData, tooltip);
            break;
        case 'line':
            renderLineChart(svg, visData, tooltip);
            break;
        case 'multi-line':
            renderMultiLineChart(svg, visData, tooltip);
            break;
    }
    // Add other visualization types as needed
}

function renderHorizontalBarChart(svg, visData, tooltip) {
    const { data, config } = visData;
    const margin = config.margin;
    const width = config.width - margin.left - margin.right;
    const height = config.height - margin.top - margin.bottom;

    // Create chart group
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Create scales
    const x = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .range([0, width]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([0, height])
        .padding(0.1);

    // Add X axis
    g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x)
            .ticks(5)
            .tickFormat(d => `$${d3.format(",.0f")(d)}`))
        .append("text")
        .attr("x", width / 2)
        .attr("y", 35)
        .attr("fill", "black")
        .text(config.xAxis.label);

    // Add Y axis
    g.append("g")
        .call(d3.axisLeft(y))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -margin.left + 10)
        .attr("x", -height / 2)
        .attr("fill", "black")
        .text(config.yAxis.label);

    // Add bars
    g.selectAll(".bar")
        .data(data)
        .enter()
        .append("rect")
        .attr("class", "bar")
        .attr("y", d => y(d.label))
        .attr("height", y.bandwidth())
        .attr("x", 0)
        .attr("width", d => x(d.value))
        .attr("fill", "#69b3a2");

    // Add value labels
    g.selectAll(".value-label")
        .data(data)
        .enter()
        .append("text")
        .attr("class", "value-label")
        .attr("x", d => x(d.value) + 5)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("dy", ".35em")
        .text(d => `$${d3.format(",.0f")(d.value)}`);
}

function renderLineChart(svg, visData, tooltip) {
    const { data, config } = visData;
    const margin = config.margin;
    const width = config.width - margin.left - margin.right;
    const height = config.height - margin.top - margin.bottom;

    // Create chart group
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Parse dates and values
    const parseDate = d3.isoParse;
    const formattedData = data.map(d => ({
        date: parseDate(d.x),
        value: d.y
    }));

    // Create scales
    const x = d3.scaleTime()
        .domain(d3.extent(formattedData, d => d.date))
        .range([0, width]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(formattedData, d => d.value)])
        .range([height, 0]);

    // Add X axis
    g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x)
            .ticks(d3.timeMonth.every(3))
            .tickFormat(d3.timeFormat("%b %Y")))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");

    // Add Y axis
    g.append("g")
        .call(d3.axisLeft(y)
            .tickFormat(d => `$${d3.format(",.0f")(d)}`));

    // Add axis labels
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - (height / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .text(config.yAxis.label);

    // Add the line
    const line = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.value));

    g.append("path")
        .datum(formattedData)
        .attr("fill", "none")
        .attr("stroke", "#69b3a2")
        .attr("stroke-width", 2)
        .attr("d", line);

    // Add dots with tooltips
    g.selectAll("dot")
        .data(formattedData)
        .enter()
        .append("circle")
        .attr("cx", d => x(d.date))
        .attr("cy", d => y(d.value))
        .attr("r", 5)
        .attr("fill", "#69b3a2")
        .on("mouseover", function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr("r", 8);

            tooltip.transition()
                .duration(200)
                .style("opacity", .9);
            
            tooltip.html(
                `Date: ${d.date.toLocaleDateString()}<br/>` +
                `Sales: $${d.value.toLocaleString()}`
            )
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function() {
            d3.select(this)
                .transition()
                .duration(200)
                .attr("r", 5);

            tooltip.transition()
                .duration(500)
                .style("opacity", 0);
        });
}

function renderMultiLineChart(svg, visData, tooltip) {
    const { data, config } = visData;
    const margin = config.margin;
    const width = config.width - margin.left - margin.right;
    const height = config.height - margin.top - margin.bottom;

    // Create chart group
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Combine all values for scales
    const allValues = data.flatMap(d => d.values);

    // Create scales
    const x = d3.scaleTime()
        .domain(d3.extent(allValues, d => new Date(d.x)))
        .range([0, width]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(allValues, d => d.y)])
        .range([height, 0]);

    // Color scale for different states
    const color = d3.scaleOrdinal(d3.schemeCategory10);

    // Add X axis
    g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x)
            .ticks(d3.timeMonth.every(3))
            .tickFormat(d3.timeFormat("%b %Y")))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");

    // Add Y axis
    g.append("g")
        .call(d3.axisLeft(y)
            .tickFormat(d => `$${d3.format(",.0f")(d)}`));

    // Add axis labels
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - (height / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .text(config.yAxis.label);

    // Create line generator
    const line = d3.line()
        .x(d => x(new Date(d.x)))
        .y(d => y(d.y));

    // Add lines and dots for each series
    data.forEach((series, i) => {
        g.append("path")
            .datum(series.values)
            .attr("fill", "none")
            .attr("stroke", color(i))
            .attr("stroke-width", 2)
            .attr("d", line);

        // Add dots with tooltips
        g.selectAll(`dot-${i}`)
            .data(series.values)
            .enter()
            .append("circle")
            .attr("cx", d => x(new Date(d.x)))
            .attr("cy", d => y(d.y))
            .attr("r", 5)
            .attr("fill", color(i))
            .on("mouseover", function(event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr("r", 8);

                tooltip.transition()
                    .duration(200)
                    .style("opacity", .9);
                
                tooltip.html(
                    `State: ${series.name}<br/>` +
                    `Date: ${new Date(d.x).toLocaleDateString()}<br/>` +
                    `Sales: $${d.y.toLocaleString()}`
                )
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function() {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr("r", 5);

                tooltip.transition()
                    .duration(500)
                    .style("opacity", 0);
            });
    });

    // Add legend
    const legend = g.append("g")
        .attr("font-family", "sans-serif")
        .attr("font-size", 10)
        .attr("text-anchor", "start")
        .selectAll("g")
        .data(data)
        .enter().append("g")
        .attr("transform", (d, i) => `translate(${width + 10},${i * 20})`);

    legend.append("rect")
        .attr("x", 0)
        .attr("width", 19)
        .attr("height", 19)
        .attr("fill", (d, i) => color(i));

    legend.append("text")
        .attr("x", 24)
        .attr("y", 9.5)
        .attr("dy", "0.32em")
        .text(d => d.name);
}

function renderBarChart(svg, data, width, height, margin) {
    // Implementation for bar chart
    // ... (add if needed)
}

// Export the render function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderD3Visualization };
} else {
    // For browser environment
    window.renderD3Visualization = renderD3Visualization;
} 